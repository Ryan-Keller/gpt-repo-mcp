import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { RootRegistry } from "./services/root-registry.js";
import { createMcpServer } from "./register.js";
import { getToolCatalogForProfile } from "./tools/catalog.js";
import { toolCatalogProfileFromEnv } from "./tools/catalog-profile.js";
import { getServerInstructions } from "./instructions.js";
import { buildToolCatalogDiagnostic } from "./runtime/tool-catalog-diagnostic.js";
import type { RuntimeContext } from "./runtime/context.js";
import {
  authorizeBridgeRequest,
  buildBridgeAuthConfig,
  buildPublicSafeHealth,
  getToolAccessTier,
  type AccessTier,
  type BridgeAuthorizationDecision
} from "./runtime/access-control.js";
import { appendBridgeSecurityEvent, type BridgeSecurityEventType } from "./runtime/bridge-security-events.js";
import {
  getConnectorDiagnostics,
  initializeConnectorDiagnostics,
  recordConnectorRequestOutcome,
  recordConnectorSessionClosed
} from "./runtime/connector-session.js";
import { BridgeRuntimeDiagnostics, sessionFingerprint } from "./runtime/session-observability.js";
import {
  buildMcpRoutePatterns,
  isAuthorizedMcpPath,
  isPublicTokenMcpPath,
  sanitizeMcpRouteForAudit
} from "./runtime/mcp-routes.js";
import {
  createRequestId,
  requestAudit,
  withRequestTelemetry,
  type RequestTelemetryContext
} from "./runtime/telemetry.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.GPT_REPO_HOST ?? process.env.HOST ?? "127.0.0.1";
const configPath = process.env.GPT_REPO_CONFIG ?? process.env.REPO_READER_CONFIG;
const publicPathToken = process.env.GPT_REPO_PUBLIC_PATH_TOKEN ?? process.env.REPO_READER_PUBLIC_PATH_TOKEN;
const authToken = process.env.BRIDGE_AUTH_TOKEN ?? process.env.GPT_REPO_AUTH_TOKEN ?? process.env.REPO_READER_AUTH_TOKEN;
const allowPathTokenConnectorAuth = process.env.BRIDGE_ALLOW_PATH_TOKEN_CONNECTOR_AUTH ??
  process.env.GPT_REPO_ALLOW_PATH_TOKEN_CONNECTOR_AUTH;

const registry = configPath
  ? await RootRegistry.fromFile(configPath)
  : await RootRegistry.fromConfig({ repos: [], limits: {} });
const startedAt = new Date().toISOString();
const toolProfile = toolCatalogProfileFromEnv();
const activeToolCatalog = getToolCatalogForProfile(toolProfile);
const toolNames = activeToolCatalog.map((tool) => tool.name).sort();
const buildTimestamp = process.env.GPT_REPO_BUILD_TIMESTAMP ?? startedAt;
const initialDiagnostic = buildToolCatalogDiagnostic({
  startedAt,
  buildTimestamp,
  toolCatalog: activeToolCatalog,
  toolProfile
});
const diagnostics = new BridgeRuntimeDiagnostics({
  startedAt,
  buildTimestamp,
  transportType: "streamable_http",
  toolCatalog: activeToolCatalog,
  toolProfile
});
const context: RuntimeContext = { registry, diagnostics };
const authConfig = buildBridgeAuthConfig({
  authToken,
  publicPathToken,
  publicMode: process.env.BRIDGE_PUBLIC_MODE ?? process.env.GPT_REPO_PUBLIC_MODE,
  allowPathTokenConnectorAuth
});
initializeConnectorDiagnostics({
  server_started_at: startedAt,
  tool_catalog_hash: initialDiagnostic.tool_catalog_hash,
  contract_schema_version: "2026-06-07-public-security-v1",
  auth_status: authConfig.tokenConfigured
    ? "configured"
    : authConfig.publicExposure
      ? "missing_public_mode"
      : "local_dev_unauthenticated"
});

if (authConfig.warning) {
  console.error(JSON.stringify({
    level: "audit",
    event: "auth_missing",
    severity: "warning",
    reason: authConfig.warning,
    suggested_next_action: "set_BRIDGE_AUTH_TOKEN_and_configure_connector_header"
  }));
  await appendBridgeSecurityEvent(registry, {
    event_type: "auth_missing",
    severity: "warning",
    caller_classification: "unknown",
    operation: "server_startup",
    allowed: false,
    reason: authConfig.warning,
    suggested_next_action: "set_BRIDGE_AUTH_TOKEN_and_configure_connector_header"
  });
}

if (authConfig.allowPathTokenConnectorAuth) {
  console.error(JSON.stringify({
    level: "audit",
    event: "path_token_connector_auth_enabled",
    severity: "warning",
    reason: "Public path token is accepted as connector authentication for headerless connector compatibility.",
    suggested_next_action: "treat_the_full_connector_url_as_a_secret_and_prefer_BRIDGE_AUTH_TOKEN_headers_when_available"
  }));
  await appendBridgeSecurityEvent(registry, {
    event_type: "path_token_connector_auth_enabled",
    severity: "warning",
    caller_classification: "local",
    operation: "server_startup",
    allowed: true,
    reason: "Path-token connector auth compatibility mode enabled for headerless connector support.",
    suggested_next_action: "treat_the_full_connector_url_as_a_secret_and_prefer_BRIDGE_AUTH_TOKEN_headers_when_available"
  });
}

await appendBridgeSecurityEvent(registry, {
  event_type: "bridge_restarted",
  severity: "info",
  caller_classification: "local",
  operation: "server_startup",
  allowed: true,
  reason: "GPT Repo MCP process started",
  evidence: {
    bridge_process_id: process.pid,
    bridge_started_at: startedAt,
    tool_catalog_generation: initialDiagnostic.tool_catalog_hash
  },
  suggested_next_action: "if ChatGPT reports Session terminated, compare bridge_started_at and tool_catalog_generation with the previous repo_list_roots response"
});
await appendBridgeSecurityEvent(registry, {
  event_type: "tool_catalog_refreshed",
  severity: "info",
  caller_classification: "local",
  operation: "tool_catalog_load",
  allowed: true,
  reason: "Tool catalog loaded for this bridge process",
  evidence: {
    bridge_process_id: process.pid,
    bridge_started_at: startedAt,
    tool_catalog_generation: initialDiagnostic.tool_catalog_hash,
    tool_count: toolNames.length,
    tool_profile: toolProfile
  },
  suggested_next_action: "refresh connector cache or start a new MCP session if ChatGPT still sees an older tool surface"
});

const app = express();
app.use(express.json({ limit: "2mb" }));

const transports: Record<string, StreamableHTTPServerTransport> = {};
const mcpRoutePatterns = buildMcpRoutePatterns(publicPathToken);

app.get("/health", async (req, res) => {
  const decision = authorizeHttpRequest(req, "GET /health detail", "authenticated_read");
  if (!decision.allowed) {
    await recordSecurityDecision(decision, "sensitive_status_redacted", "warning");
    res.json(buildPublicSafeHealth({
      status: authConfig.warning ? "locked" : "ok",
      authenticationRequired: authConfig.authRequired
    }));
    return;
  }
  await recordSecurityDecision({
    ...decision,
    operation: "GET /health"
  }, "auth_allowed", "info");
  res.json(buildDetailedHealth());
});

app.get("/tool-catalog", async (req, res) => {
  const decision = authorizeHttpRequest(req, "GET /tool-catalog", "authenticated_read");
  if (!decision.allowed) {
    await recordSecurityDecision(decision, "auth_denied", "warning");
    res.status(decision.http_status).json(deniedStatus(decision));
    return;
  }
  await recordSecurityDecision(decision, "auth_allowed", "info");
  res.json(buildToolCatalogDiagnostic({
    startedAt,
    buildTimestamp,
    toolCatalog: activeToolCatalog,
    toolProfile
  }));
});

app.get("/whoami", async (req, res) => {
  const decision = authorizeHttpRequest(req, "GET /whoami", "authenticated_read");
  const publicTokenPath = req.path.startsWith("/t/") && req.path.endsWith("/whoami");
  const routeTokenValid = publicTokenPath && isPublicWhoamiTokenPath(req.path);
  if (!decision.allowed) {
    await recordSecurityDecision(decision, "auth_denied", "warning");
    res.status(decision.http_status).json(deniedStatus(decision));
    return;
  }
  await recordSecurityDecision(decision, "auth_allowed", "info");
  res.json(buildWhoamiDiagnostic(req, {
    route: "/whoami",
    routeTokenPresent: publicTokenPath,
    routeTokenValid
  }));
});

app.get("/t/:publicPathToken/whoami", async (req, res) => {
  const routeTokenValid = isPublicWhoamiTokenPath(req.path);
  const decision = authorizeBridgeRequest({
    config: authConfig,
    accessTier: "authenticated_read",
    operation: "GET /whoami",
    headers: req.headers,
    remoteAddress: req.ip || req.socket.remoteAddress,
    publicPathTokenAuthenticated: routeTokenValid
  });
  if (!decision.allowed) {
    await recordSecurityDecision(decision, "auth_denied", "warning");
    res.status(decision.http_status).json(deniedStatus(decision));
    return;
  }
  await recordSecurityDecision(decision, "auth_allowed", "info");
  res.json(buildWhoamiDiagnostic(req, {
    route: "/t/[token]/whoami",
    routeTokenPresent: true,
    routeTokenValid
  }));
});

function createMcpRequestContext(req: Request): RequestTelemetryContext {
  const method = typeof req.body?.method === "string" ? req.body.method : undefined;
  const tool =
    method === "tools/call" && typeof req.body?.params?.name === "string"
      ? req.body.params.name
      : undefined;
  const resourceUri =
    method === "resources/read" && typeof req.body?.params?.uri === "string"
      ? req.body.params.uri
      : undefined;
  const publicTokenPath = req.path.startsWith("/t/");

  return {
    request_id: createRequestId(),
    http_method: req.method,
    route: sanitizeMcpRouteForAudit(req.path),
    mcp_session: typeof req.headers["mcp-session-id"] === "string" ? "present" : "missing",
    session_fingerprint: sessionFingerprint(typeof req.headers["mcp-session-id"] === "string" ? req.headers["mcp-session-id"] : undefined),
    mcp_method: method,
    mcp_tool: tool,
    mcp_resource_uri: resourceUri,
    route_token_present: publicTokenPath,
    route_token_valid: publicTokenPath && isPublicTokenMcpPath(req.path, publicPathToken),
    authorization_header_present: typeof req.headers.authorization === "string",
    bridge_auth_header_present: typeof req.headers["x-bridge-auth-token"] === "string" ||
      typeof req.headers["x-gpt-repo-auth-token"] === "string",
    cloudflare_access_email_present: typeof req.headers["cf-access-authenticated-user-email"] === "string",
    cloudflare_access_jwt_present: typeof req.headers["cf-access-jwt-assertion"] === "string",
    cf_ray_present: typeof req.headers["cf-ray"] === "string",
    forwarded_proto: typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"] : ""
  };
}

function attachMcpRequestAuditing(res: Response, context: RequestTelemetryContext, startedAt: number): void {
  res.on("finish", () => {
    recordConnectorRequestOutcome({
      ok: res.statusCode < 400,
      tool: context.mcp_tool ?? context.mcp_method,
      error_kind: res.statusCode < 400 ? undefined : connectorErrorKind(res.statusCode, context),
      occurred_at: new Date().toISOString()
    });
    requestAudit({
      event: "mcp_request_finish",
      request_id: context.request_id,
      http_method: context.http_method ?? "UNKNOWN",
      route: context.route ?? "/mcp",
      status_code: res.statusCode,
      duration_ms: Date.now() - startedAt,
      mcp_session: context.mcp_session,
      mcp_method: context.mcp_method,
      mcp_tool: context.mcp_tool,
      mcp_resource_uri: context.mcp_resource_uri
    });
  });
}

function rejectUnauthorizedMcpPath(req: Request, res: Response): boolean {
  if (isAuthorizedMcpPath(req.path, publicPathToken)) {
    return false;
  }
  res.status(404).send("Not found");
  return true;
}

function buildDetailedHealth() {
  const diagnostic = buildToolCatalogDiagnostic({
    startedAt,
    buildTimestamp,
    toolCatalog: activeToolCatalog,
    toolProfile
  });
  return {
    ok: true,
    name: "gpt-repo-mcp",
    started_at: startedAt,
    build_timestamp: buildTimestamp,
    tool_profile: toolProfile,
    tool_count: toolNames.length,
    tool_catalog_hash: diagnostic.tool_catalog_hash,
    codex_tools: toolNames.filter((name) => name.includes("codex")),
    required_tools: diagnostic.required_tools,
    authentication_required: authConfig.authRequired,
    auth_status: authConfig.tokenConfigured ? "configured" : authConfig.publicExposure ? "missing_public_mode" : "local_dev_unauthenticated",
    path_token_connector_auth: authConfig.allowPathTokenConnectorAuth ? "enabled" : "disabled",
    connector: getConnectorDiagnostics()
  };
}

function buildWhoamiDiagnostic(req: Request, input: {
  route: string;
  routeTokenPresent: boolean;
  routeTokenValid: boolean;
}) {
  const authorizationHeaderPresent = typeof req.headers.authorization === "string";
  const bridgeAuthHeaderPresent = typeof req.headers["x-bridge-auth-token"] === "string" ||
    typeof req.headers["x-gpt-repo-auth-token"] === "string";
  const cloudflareAccessEmailPresent = typeof req.headers["cf-access-authenticated-user-email"] === "string";
  const cloudflareAccessJwtPresent = typeof req.headers["cf-access-jwt-assertion"] === "string";
  const callerHint = input.routeTokenValid
    ? "tokenized_route"
    : authorizationHeaderPresent || bridgeAuthHeaderPresent
      ? "header_auth_candidate"
      : cloudflareAccessEmailPresent || cloudflareAccessJwtPresent
        ? "cloudflare_access_candidate"
        : "public_or_unknown";
  return {
    ok: true,
    observed_at: new Date().toISOString(),
    bridge_process_id: process.pid,
    bridge_started_at: startedAt,
    route: input.route,
    http_method: req.method,
    authentication_required: authConfig.authRequired,
    auth_status: authConfig.tokenConfigured ? "configured" : authConfig.publicExposure ? "missing_public_mode" : "local_dev_unauthenticated",
    path_token_connector_auth: authConfig.allowPathTokenConnectorAuth ? "enabled" : "disabled",
    public_path_token_configured: Boolean(publicPathToken),
    route_token_present: input.routeTokenPresent,
    route_token_valid: input.routeTokenValid,
    authorization_header_present: authorizationHeaderPresent,
    bridge_auth_header_present: bridgeAuthHeaderPresent,
    cloudflare_access_email_present: cloudflareAccessEmailPresent,
    cloudflare_access_jwt_present: cloudflareAccessJwtPresent,
    cf_ray_present: typeof req.headers["cf-ray"] === "string",
    forwarded_proto: typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"] : "",
    caller_classification_hint: callerHint,
    interpretation: "This endpoint reports presence/absence of connector identity signals only. It never returns token, email, JWT, cookie, or header values.",
    suggested_next_action: callerHint === "tokenized_route"
      ? "Tokenized connector compatibility mode is in use; treat the full URL as a secret."
      : callerHint === "header_auth_candidate"
        ? "Header-auth /mcp mode may be viable for this connector path."
        : callerHint === "cloudflare_access_candidate"
          ? "Cloudflare Access identity material is present; evaluate whether it is stable enough for policy."
          : "No stable identity signal observed; use tokenized route or a broker."
  };
}

function isPublicWhoamiTokenPath(path: string): boolean {
  if (!publicPathToken || !path.startsWith("/t/") || !path.endsWith("/whoami")) {
    return false;
  }
  const expected = `/t/${encodeURIComponent(publicPathToken)}/whoami`;
  return path === expected;
}

function authorizeHttpRequest(req: Request, operation: string, accessTier: AccessTier): BridgeAuthorizationDecision {
  return authorizeBridgeRequest({
    config: authConfig,
    accessTier,
    operation,
    headers: req.headers,
    remoteAddress: req.ip || req.socket.remoteAddress,
    publicPathTokenAuthenticated: isPublicTokenMcpPath(req.path, publicPathToken)
  });
}

async function recordSecurityDecision(
  decision: BridgeAuthorizationDecision,
  eventType: BridgeSecurityEventType,
  severity: "info" | "warning" | "error"
): Promise<void> {
  await appendBridgeSecurityEvent(registry, {
    event_type: eventType,
    severity,
    caller_classification: decision.caller_classification,
    operation: decision.operation,
    allowed: decision.allowed,
    reason: decision.reason,
    suggested_next_action: decision.suggested_next_action
  });
}

function deniedStatus(decision: BridgeAuthorizationDecision) {
  return {
    ok: false,
    error: {
      code: decision.reason,
      message: decision.reason === "auth_not_configured_for_public_mode"
        ? "Bridge authentication is not configured for public/tunnel mode."
        : "Authentication required.",
      retryable: true
    },
    authentication_required: true,
    suggested_next_action: decision.suggested_next_action
  };
}

function connectorErrorKind(statusCode: number, context: RequestTelemetryContext): string {
  if (statusCode === 401 || statusCode === 403 || statusCode === 503) {
    return "auth_denied";
  }
  if (statusCode === 400 && context.mcp_session === "missing") {
    return "missing_mcp_session";
  }
  if (statusCode === 400) {
    return "invalid_mcp_session";
  }
  if (statusCode === 408 || statusCode === 504) {
    return "request_timeout";
  }
  return "transport_or_request_error";
}

async function rejectUnauthorizedBridgeAccess(req: Request, res: Response, context: RequestTelemetryContext): Promise<boolean> {
  const operation = context.mcp_tool ?? context.mcp_method ?? "mcp_request";
  const accessTier = getToolAccessTier(context.mcp_tool);
  const decision = authorizeHttpRequest(req, operation, accessTier);
  if (decision.allowed) {
    if (accessTier === "bounded_packet_write" || accessTier === "privileged_write" || accessTier === "dangerous_git") {
      await recordSecurityDecision(decision, "privileged_action_allowed", "info");
    }
    return false;
  }
  await recordSecurityDecision(
    decision,
    accessTier === "bounded_packet_write" || accessTier === "privileged_write" || accessTier === "dangerous_git" ? "privileged_action_denied" : "auth_denied",
    "warning"
  );
  recordConnectorRequestOutcome({
    ok: false,
    tool: operation,
    error_kind: "auth_denied",
    occurred_at: new Date().toISOString()
  });
  res.status(decision.http_status).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Authentication required" },
    id: null
  });
  return true;
}

app.post(mcpRoutePatterns, async (req: Request, res: Response) => {
  const requestContext = createMcpRequestContext(req);
  const requestStartedAt = Date.now();
  attachMcpRequestAuditing(res, requestContext, requestStartedAt);

  return withRequestTelemetry(requestContext, async () => {
    requestAudit({
      event: "mcp_request_start",
      request_id: requestContext.request_id,
      http_method: requestContext.http_method ?? "POST",
      route: requestContext.route ?? "/mcp",
      mcp_session: requestContext.mcp_session,
      mcp_method: requestContext.mcp_method,
      mcp_tool: requestContext.mcp_tool,
      mcp_resource_uri: requestContext.mcp_resource_uri
    });

    if (rejectUnauthorizedMcpPath(req, res)) {
      return;
    }
    if (await rejectUnauthorizedBridgeAccess(req, res, requestContext)) {
      return;
    }

    const sessionId = req.headers["mcp-session-id"];
    try {
      let transport: StreamableHTTPServerTransport | undefined;
      if (typeof sessionId === "string" && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            if (transport) {
              transports[newSessionId] = transport;
            }
          }
        });
        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId) {
            delete transports[closedSessionId];
          }
          recordConnectorSessionClosed({ reason: "session_terminated" });
          void appendBridgeSecurityEvent(registry, {
            event_type: "connector_session_terminated",
            severity: "warning",
            caller_classification: "connector",
            operation: "mcp_transport",
            allowed: false,
            reason: "MCP transport session closed",
            suggested_next_action: "refresh connector, re-open chat, validate tool catalog, then retry compact status call"
          });
        };
        await createMcpServer(context, {
          toolProfile,
          toolCatalog: activeToolCatalog,
          instructions: getServerInstructions(toolProfile)
        }).connect(transport);
      } else {
        const errorCode = -32000;
        await appendBridgeSecurityEvent(registry, {
          event_type: isInitializeRequest(req.body) ? "invalid_json_rpc_request" : "tool_session_terminated",
          severity: "warning",
          caller_classification: "connector",
          operation: requestContext.mcp_tool ?? requestContext.mcp_method ?? "mcp_post",
          allowed: false,
          reason: "Bad Request: no valid MCP session",
          evidence: {
            request_id: requestContext.request_id,
            mcp_session: requestContext.mcp_session ?? "missing",
            session_fingerprint: requestContext.session_fingerprint ?? "",
            json_rpc_error_code: errorCode,
            bridge_process_id: process.pid,
            bridge_started_at: startedAt
          },
          suggested_next_action: "retry repo_list_roots in a fresh MCP session; if repeated, restart the connector"
        });
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: errorCode, message: "Bad Request: no valid MCP session" },
          id: null
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch {
      await appendBridgeSecurityEvent(registry, {
        event_type: "unknown_tool_session_failure",
        severity: "error",
        caller_classification: "connector",
        operation: requestContext.mcp_tool ?? requestContext.mcp_method ?? "mcp_post",
        allowed: false,
        reason: "MCP POST request failed inside bridge request handling",
        evidence: {
          request_id: requestContext.request_id,
          mcp_session: requestContext.mcp_session ?? "missing",
          session_fingerprint: requestContext.session_fingerprint ?? "",
          json_rpc_error_code: -32603,
          bridge_process_id: process.pid,
          bridge_started_at: startedAt
        },
        suggested_next_action: "check bridge /health, retry repo_list_roots in a fresh MCP session, and inspect recent bridge events before blaming the runner"
      });
      requestAudit({
        event: "mcp_request_error",
        request_id: requestContext.request_id,
        http_method: requestContext.http_method ?? "POST",
        route: requestContext.route ?? "/mcp",
        duration_ms: Date.now() - requestStartedAt,
        mcp_session: requestContext.mcp_session,
        mcp_method: requestContext.mcp_method,
        mcp_tool: requestContext.mcp_tool
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    }
  });
});

app.get(mcpRoutePatterns, async (req: Request, res: Response) => {
  const requestContext = createMcpRequestContext(req);
  const requestStartedAt = Date.now();
  attachMcpRequestAuditing(res, requestContext, requestStartedAt);

  return withRequestTelemetry(requestContext, async () => {
    requestAudit({
      event: "mcp_request_start",
      request_id: requestContext.request_id,
      http_method: requestContext.http_method ?? "GET",
      route: requestContext.route ?? "/mcp",
      mcp_session: requestContext.mcp_session,
      mcp_method: requestContext.mcp_method,
      mcp_tool: requestContext.mcp_tool
    });

    if (rejectUnauthorizedMcpPath(req, res)) {
      return;
    }
    if (await rejectUnauthorizedBridgeAccess(req, res, requestContext)) {
      return;
    }

    try {
      const sessionId = req.headers["mcp-session-id"];
      if (typeof sessionId !== "string" || !transports[sessionId]) {
        await appendBridgeSecurityEvent(registry, {
          event_type: "tool_session_terminated",
          severity: "warning",
          caller_classification: "connector",
          operation: "mcp_get_stream",
          allowed: false,
          reason: "Invalid or missing MCP session id",
          evidence: {
            request_id: requestContext.request_id,
            mcp_session: requestContext.mcp_session ?? "missing",
            session_fingerprint: requestContext.session_fingerprint ?? "",
            status_code: 400,
            bridge_process_id: process.pid,
            bridge_started_at: startedAt
          },
          suggested_next_action: "retry repo_list_roots in a fresh MCP session; if repeated, restart the connector"
        });
        recordConnectorRequestOutcome({
          ok: false,
          tool: requestContext.mcp_method,
          error_kind: "invalid_mcp_session",
          occurred_at: new Date().toISOString()
        });
        res.status(400).send("Invalid or missing MCP session id");
        return;
      }
      await transports[sessionId].handleRequest(req, res);
    } catch {
      await appendBridgeSecurityEvent(registry, {
        event_type: "transport_disconnect",
        severity: "error",
        caller_classification: "connector",
        operation: "mcp_get_stream",
        allowed: false,
        reason: "MCP GET stream request failed during transport handling",
        evidence: {
          request_id: requestContext.request_id,
          mcp_session: requestContext.mcp_session ?? "missing",
          session_fingerprint: requestContext.session_fingerprint ?? "",
          status_code: 500,
          bridge_process_id: process.pid,
          bridge_started_at: startedAt
        },
        suggested_next_action: "retry once, then check bridge /health and connector network/session state"
      });
      requestAudit({
        event: "mcp_request_error",
        request_id: requestContext.request_id,
        http_method: requestContext.http_method ?? "GET",
        route: requestContext.route ?? "/mcp",
        duration_ms: Date.now() - requestStartedAt,
        mcp_session: requestContext.mcp_session,
        mcp_method: requestContext.mcp_method,
        mcp_tool: requestContext.mcp_tool
      });
      if (!res.headersSent) {
        res.status(500).send("Internal server error");
      }
    }
  });
});

app.delete(mcpRoutePatterns, async (req: Request, res: Response) => {
  const requestContext = createMcpRequestContext(req);
  const requestStartedAt = Date.now();
  attachMcpRequestAuditing(res, requestContext, requestStartedAt);

  return withRequestTelemetry(requestContext, async () => {
    requestAudit({
      event: "mcp_request_start",
      request_id: requestContext.request_id,
      http_method: requestContext.http_method ?? "DELETE",
      route: requestContext.route ?? "/mcp",
      mcp_session: requestContext.mcp_session,
      mcp_method: requestContext.mcp_method,
      mcp_tool: requestContext.mcp_tool
    });

    if (rejectUnauthorizedMcpPath(req, res)) {
      return;
    }
    if (await rejectUnauthorizedBridgeAccess(req, res, requestContext)) {
      return;
    }

    try {
      const sessionId = req.headers["mcp-session-id"];
      if (typeof sessionId !== "string" || !transports[sessionId]) {
        await appendBridgeSecurityEvent(registry, {
          event_type: "tool_session_terminated",
          severity: "warning",
          caller_classification: "connector",
          operation: "mcp_delete",
          allowed: false,
          reason: "Invalid or missing MCP session id",
          evidence: {
            request_id: requestContext.request_id,
            mcp_session: requestContext.mcp_session ?? "missing",
            session_fingerprint: requestContext.session_fingerprint ?? "",
            status_code: 400,
            bridge_process_id: process.pid,
            bridge_started_at: startedAt
          },
          suggested_next_action: "retry repo_list_roots in a fresh MCP session; if repeated, restart the connector"
        });
        recordConnectorRequestOutcome({
          ok: false,
          tool: requestContext.mcp_method,
          error_kind: "invalid_mcp_session",
          occurred_at: new Date().toISOString()
        });
        res.status(400).send("Invalid or missing MCP session id");
        return;
      }
      await transports[sessionId].handleRequest(req, res);
    } catch {
      await appendBridgeSecurityEvent(registry, {
        event_type: "transport_disconnect",
        severity: "error",
        caller_classification: "connector",
        operation: "mcp_delete",
        allowed: false,
        reason: "MCP DELETE request failed during transport handling",
        evidence: {
          request_id: requestContext.request_id,
          mcp_session: requestContext.mcp_session ?? "missing",
          session_fingerprint: requestContext.session_fingerprint ?? "",
          status_code: 500,
          bridge_process_id: process.pid,
          bridge_started_at: startedAt
        },
        suggested_next_action: "retry once, then check bridge /health and connector network/session state"
      });
      requestAudit({
        event: "mcp_request_error",
        request_id: requestContext.request_id,
        http_method: requestContext.http_method ?? "DELETE",
        route: requestContext.route ?? "/mcp",
        duration_ms: Date.now() - requestStartedAt,
        mcp_session: requestContext.mcp_session,
        mcp_method: requestContext.mcp_method,
        mcp_tool: requestContext.mcp_tool
      });
      if (!res.headersSent) {
        res.status(500).send("Internal server error");
      }
    }
  });
});

app.listen(port, host, () => {
  const localPath = publicPathToken ? "/t/[token]/mcp" : "/mcp";
  console.error(`gpt-repo-mcp listening on http://${host}:${port}${localPath}`);
});
