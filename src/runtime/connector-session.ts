export type ConnectorStatus = "unknown" | "healthy" | "degraded" | "terminated" | "stale";

export type ConnectorDiagnostics = {
  connector_status: ConnectorStatus;
  last_connector_success_at: string;
  last_connector_error_at: string;
  last_connector_error_kind: string;
  last_successful_tool_call: string;
  last_failed_tool_call: string;
  suspected_cause: string;
  suggested_next_action: string;
  server_started_at: string;
  current_uptime_seconds: number;
  tool_catalog_hash: string;
  contract_schema_version: string;
  auth_status: string;
};

type RuntimeMetadata = {
  server_started_at?: string;
  tool_catalog_hash?: string;
  contract_schema_version?: string;
  auth_status?: string;
};

type RequestOutcome = {
  ok: boolean;
  tool?: string;
  error_kind?: string;
  occurred_at?: string;
};

const DEFAULT_CONTRACT_SCHEMA_VERSION = "2026-06-07-public-security-v1";

let metadata: RuntimeMetadata = {
  contract_schema_version: DEFAULT_CONTRACT_SCHEMA_VERSION
};

let state = {
  connector_status: "unknown" as ConnectorStatus,
  last_connector_success_at: "",
  last_connector_error_at: "",
  last_connector_error_kind: "",
  last_successful_tool_call: "",
  last_failed_tool_call: "",
  suspected_cause: "No connector requests have been observed since this process started.",
  suggested_next_action: "make_a_small_status_tool_call_then_recheck_connector_diagnostics"
};

export function initializeConnectorDiagnostics(input: RuntimeMetadata): void {
  metadata = {
    ...metadata,
    ...input
  };
}

export function recordConnectorRequestOutcome(input: RequestOutcome): void {
  const occurredAt = input.occurred_at ?? new Date().toISOString();
  const tool = input.tool ?? "";
  if (input.ok) {
    state = {
      ...state,
      connector_status: "healthy",
      last_connector_success_at: occurredAt,
      last_successful_tool_call: tool || state.last_successful_tool_call,
      suspected_cause: "Recent MCP/tool request completed successfully.",
      suggested_next_action: "continue"
    };
    return;
  }

  const errorKind = input.error_kind ?? "transport_or_request_error";
  state = {
    ...state,
    connector_status: errorKind === "session_terminated" ? "degraded" : "degraded",
    last_connector_error_at: occurredAt,
    last_connector_error_kind: errorKind,
    last_failed_tool_call: tool || state.last_failed_tool_call,
    suspected_cause: suspectedCause(errorKind),
    suggested_next_action: suggestedNextAction(errorKind)
  };
}

export function recordConnectorSessionClosed(input: { occurred_at?: string; reason?: string } = {}): void {
  const occurredAt = input.occurred_at ?? new Date().toISOString();
  state = {
    ...state,
    connector_status: "terminated",
    last_connector_error_at: occurredAt,
    last_connector_error_kind: input.reason ?? "session_terminated",
    suspected_cause: "The MCP transport session closed or was lost independently of runner health.",
    suggested_next_action: "refresh connector, re-open chat, then validate tool catalog and auth token"
  };
}

export function getConnectorDiagnostics(): ConnectorDiagnostics {
  return {
    connector_status: state.connector_status,
    last_connector_success_at: state.last_connector_success_at,
    last_connector_error_at: state.last_connector_error_at,
    last_connector_error_kind: state.last_connector_error_kind,
    last_successful_tool_call: state.last_successful_tool_call,
    last_failed_tool_call: state.last_failed_tool_call,
    suspected_cause: state.suspected_cause,
    suggested_next_action: state.suggested_next_action,
    server_started_at: metadata.server_started_at ?? "",
    current_uptime_seconds: uptimeSeconds(metadata.server_started_at),
    tool_catalog_hash: metadata.tool_catalog_hash ?? "",
    contract_schema_version: metadata.contract_schema_version ?? DEFAULT_CONTRACT_SCHEMA_VERSION,
    auth_status: metadata.auth_status ?? "unknown"
  };
}

export function resetConnectorDiagnosticsForTests(): void {
  metadata = {
    contract_schema_version: DEFAULT_CONTRACT_SCHEMA_VERSION
  };
  state = {
    connector_status: "unknown",
    last_connector_success_at: "",
    last_connector_error_at: "",
    last_connector_error_kind: "",
    last_successful_tool_call: "",
    last_failed_tool_call: "",
    suspected_cause: "No connector requests have been observed since this process started.",
    suggested_next_action: "make_a_small_status_tool_call_then_recheck_connector_diagnostics"
  };
}

function uptimeSeconds(startedAt: string | undefined): number {
  if (!startedAt) {
    return 0;
  }
  const timestamp = Date.parse(startedAt);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}

function suspectedCause(errorKind: string): string {
  switch (errorKind) {
    case "session_terminated":
    case "missing_mcp_session":
    case "invalid_mcp_session":
      return "The bridge runner may be healthy while the connector/session transport is degraded or stale.";
    case "auth_denied":
      return "The request reached the bridge but was rejected by app-level authentication or authorization.";
    case "schema_changed":
      return "The live tool schema/catalog may have changed and the connector cache may be stale.";
    case "request_timeout":
      return "The tool call may have exceeded the connector or transport timeout.";
    default:
      return "The request failed before a successful tool response was observed.";
  }
}

function suggestedNextAction(errorKind: string): string {
  switch (errorKind) {
    case "session_terminated":
    case "missing_mcp_session":
    case "invalid_mcp_session":
      return "refresh connector, re-open chat, validate tool catalog, then retry a compact status call";
    case "auth_denied":
      return "check BRIDGE_AUTH_TOKEN and connector Authorization or x-bridge-auth-token header";
    case "schema_changed":
      return "restart MCP server, refresh connector cache, then run the live tools/list guard";
    case "request_timeout":
      return "retry with a compact request and inspect server logs for request timeout evidence";
    default:
      return "check bridge /health, connector auth, and live tools/list before blaming the runner";
  }
}
