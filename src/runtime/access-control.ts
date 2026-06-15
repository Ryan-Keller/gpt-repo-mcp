import { timingSafeEqual } from "node:crypto";

export type AccessTier = "public_safe" | "authenticated_read" | "privileged_write" | "dangerous_git" | "local_only";
export type CallerClassification = "public" | "authenticated" | "local" | "connector" | "unknown";

export type BridgeAuthConfig = {
  authToken?: string;
  tokenConfigured: boolean;
  publicExposure: boolean;
  authRequired: boolean;
  allowPathTokenConnectorAuth: boolean;
  localDevAllowsUnauthenticated: boolean;
  warning?: string;
};

export type BridgeAuthorizationDecision = {
  allowed: boolean;
  caller_classification: CallerClassification;
  operation: string;
  access_tier: AccessTier;
  reason: string;
  http_status: number;
  suggested_next_action: string;
};

export type HeaderLike = Record<string, string | string[] | undefined>;

export const ACCESS_MATRIX: Record<AccessTier, string[]> = {
  public_safe: [
    "GET /health unauthenticated",
    "redacted service liveness",
    "authentication_required flag"
  ],
  authenticated_read: [
    "repo_list_roots",
    "repo_bridge_concierge",
    "agent_runner_status",
    "repo_runner_status",
    "repo_run_live_tail",
    "repo_connector_whoami",
    "ready_results",
    "recent_events",
    "capability_summary",
    "vision_capabilities",
    "GET /tool-catalog"
  ],
  privileged_write: [
    "repo_prepare_codex_task",
    "repo_write_codex_task",
    "repo_write_codex_tasks_batch",
    "repo_lab_exec",
    "repo_town_portal_return",
    "repo_write_file",
    "repo_write_changes",
    "repo_write_handoff",
    "repo_cleanup_paths"
  ],
  dangerous_git: [
    "repo_git_stage",
    "repo_git_unstage",
    "repo_git_restore_paths",
    "repo_git_commit",
    "repo_write_stage",
    "repo_write_unstage",
    "repo_write_commit",
    "repo_write_stage_commit",
    "repo_write_recover"
  ],
  local_only: [
    "runner_control",
    "raw_process_inspection",
    "local_ollama_vision",
    "secrets_config_diagnostics"
  ]
};

const TOOL_ACCESS_TIERS: Record<string, AccessTier> = {
  repo_list_roots: "authenticated_read",
  repo_bridge_concierge: "authenticated_read",
  agent_runner_status: "authenticated_read",
  repo_runner_status: "authenticated_read",
  repo_run_live_tail: "authenticated_read",
  repo_connector_whoami: "authenticated_read",
  ready_results: "authenticated_read",
  recent_events: "authenticated_read",
  capability_summary: "authenticated_read",
  vision_capabilities: "authenticated_read",
  repo_vision_routes: "authenticated_read",
  repo_policy_explain: "authenticated_read",
  repo_last_write: "authenticated_read",
  repo_tree: "authenticated_read",
  repo_search: "authenticated_read",
  repo_fetch_file: "authenticated_read",
  repo_read_many: "authenticated_read",
  repo_git_status: "authenticated_read",
  repo_git_diff: "authenticated_read",
  repo_git_review: "authenticated_read",
  repo_project_brief: "authenticated_read",
  repo_task_inventory: "authenticated_read",
  repo_decision_memory: "authenticated_read",
  repo_change_plan: "authenticated_read",
  repo_next_action: "authenticated_read",
  repo_plan_review: "authenticated_read",
  repo_prepare_codex_task: "privileged_write",
  repo_write_codex_task: "privileged_write",
  repo_write_codex_tasks_batch: "privileged_write",
  repo_codex_review: "authenticated_read",
  codex_run_and_wait: "privileged_write",
  repo_lab_exec: "privileged_write",
  repo_town_portal_return: "privileged_write",
  repo_write_file: "privileged_write",
  repo_write_changes: "privileged_write",
  repo_write_handoff: "privileged_write",
  repo_cleanup_paths: "privileged_write",
  repo_git_stage: "dangerous_git",
  repo_git_unstage: "dangerous_git",
  repo_git_restore_paths: "dangerous_git",
  repo_git_commit: "dangerous_git",
  repo_write_stage: "dangerous_git",
  repo_write_unstage: "dangerous_git",
  repo_write_commit: "dangerous_git",
  repo_write_stage_commit: "dangerous_git",
  repo_write_recover: "dangerous_git",
  runner_control: "local_only",
  raw_process_inspection: "local_only",
  local_ollama_vision: "local_only",
  secrets_config_diagnostics: "local_only"
};

export function getToolAccessTier(toolOrSurface: string | undefined): AccessTier {
  if (!toolOrSurface) {
    return "authenticated_read";
  }
  return TOOL_ACCESS_TIERS[toolOrSurface] ?? "authenticated_read";
}

export function buildBridgeAuthConfig(input: {
  authToken?: string;
  publicPathToken?: string;
  publicMode?: string;
  allowPathTokenConnectorAuth?: string;
}): BridgeAuthConfig {
  const authToken = input.authToken?.trim();
  const tokenConfigured = Boolean(authToken);
  const publicExposure = Boolean(input.publicPathToken) || truthy(input.publicMode);
  const allowPathTokenConnectorAuth = publicExposure && truthy(input.allowPathTokenConnectorAuth);
  const authRequired = tokenConfigured || publicExposure;
  const warning = publicExposure && !tokenConfigured
    ? "BRIDGE_AUTH_TOKEN missing while public/tunnel MCP path is enabled"
    : undefined;
  return {
    ...(tokenConfigured ? { authToken } : {}),
    tokenConfigured,
    publicExposure,
    authRequired,
    allowPathTokenConnectorAuth,
    localDevAllowsUnauthenticated: !tokenConfigured && !publicExposure,
    ...(warning ? { warning } : {})
  };
}

export function buildPublicSafeHealth(input: {
  now?: string;
  status: "ok" | "degraded" | "locked";
  authenticationRequired: boolean;
}) {
  return {
    ok: true,
    name: "gpt-repo-mcp",
    alive: true,
    status: input.status,
    timestamp: input.now ?? new Date().toISOString(),
    authentication_required: input.authenticationRequired
  };
}

export function authorizeBridgeRequest(input: {
  config: BridgeAuthConfig;
  accessTier: AccessTier;
  operation: string;
  headers: HeaderLike;
  remoteAddress?: string;
  publicPathTokenAuthenticated?: boolean;
}): BridgeAuthorizationDecision {
  if (input.accessTier === "public_safe") {
    return allow("public", input, "public_safe");
  }

  if (input.accessTier === "local_only") {
    if (isLoopback(input.remoteAddress)) {
      return allow("local", input, "loopback_local_only");
    }
    return deny(input, "local_only_requires_loopback", 403, "run_this_operation_on_the_local_machine");
  }

  if (
    input.config.publicExposure &&
    input.config.allowPathTokenConnectorAuth &&
    input.publicPathTokenAuthenticated
  ) {
    return allow("connector", input, "public_path_token_connector_auth_allowed");
  }

  if (input.config.tokenConfigured) {
    const presented = presentedToken(input.headers);
    if (presented && safeTokenEqual(presented.value, input.config.authToken ?? "")) {
      return allow(presented.source === "connector_header" ? "connector" : "authenticated", input, "auth_token_valid");
    }
    return deny(input, "missing_or_invalid_auth_token", 401, "send_Authorization_Bearer_or_x_bridge_auth_token");
  }

  if (input.config.publicExposure) {
    return deny(input, "auth_not_configured_for_public_mode", 503, "set_BRIDGE_AUTH_TOKEN_and_configure_connector_header");
  }

  if (input.config.localDevAllowsUnauthenticated && isLoopback(input.remoteAddress)) {
    return allow("local", input, "local_dev_without_auth_token");
  }

  return deny(input, "auth_not_configured", 401, "set_BRIDGE_AUTH_TOKEN_or_use_loopback_local_dev");
}

function allow(
  caller: CallerClassification,
  input: Pick<Parameters<typeof authorizeBridgeRequest>[0], "operation" | "accessTier">,
  reason: string
): BridgeAuthorizationDecision {
  return {
    allowed: true,
    caller_classification: caller,
    operation: input.operation,
    access_tier: input.accessTier,
    reason,
    http_status: 200,
    suggested_next_action: "continue"
  };
}

function deny(
  input: Pick<Parameters<typeof authorizeBridgeRequest>[0], "operation" | "accessTier">,
  reason: string,
  httpStatus: number,
  suggestedNextAction: string
): BridgeAuthorizationDecision {
  return {
    allowed: false,
    caller_classification: "public",
    operation: input.operation,
    access_tier: input.accessTier,
    reason,
    http_status: httpStatus,
    suggested_next_action: suggestedNextAction
  };
}

function presentedToken(headers: HeaderLike): { value: string; source: "authorization" | "connector_header" } | undefined {
  const authorization = headerValue(headers, "authorization");
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch?.[1]) {
    return { value: bearerMatch[1], source: "authorization" };
  }

  const connectorToken = headerValue(headers, "x-bridge-auth-token") ?? headerValue(headers, "x-gpt-repo-auth-token");
  if (connectorToken) {
    return { value: connectorToken, source: "connector_header" };
  }
  return undefined;
}

function headerValue(headers: HeaderLike, key: string): string | undefined {
  const direct = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
  if (Array.isArray(direct)) {
    return direct[0];
  }
  return direct;
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

function isLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) {
    return false;
  }
  return remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1" ||
    remoteAddress.startsWith("127.");
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}
