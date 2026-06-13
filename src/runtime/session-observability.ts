import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toolCatalog } from "../tools/catalog.js";
import { buildToolCatalogDiagnostic } from "./tool-catalog-diagnostic.js";
import { getRequestTelemetry, type RequestTelemetryContext } from "./telemetry.js";
import { buildConnectorIdentitySnapshot } from "./connector-identity.js";
import type { ConnectorIdentitySnapshot } from "../contracts/connector-identity.contract.js";

const EVENT_LOG_PATH = ".chatgpt/events/bridge-events.jsonl";

export type ToolSessionFailureType =
  | "tool_session_terminated"
  | "bridge_restarted"
  | "tool_catalog_refreshed"
  | "transport_disconnect"
  | "tool_timeout"
  | "invalid_json_rpc_request"
  | "unknown_tool_session_failure";

export type ToolSessionEvent = {
  event_id: string;
  event_type: ToolSessionFailureType;
  repo_id: string;
  severity: "info" | "warning" | "error";
  observed_at: string;
  summary: string;
  evidence: Record<string, string | number | boolean | null>;
  suggested_next_action: string;
  acknowledgement_policy: string;
  dedupe_key: string;
};

export type BridgeObservabilitySnapshot = {
  bridge_process_id: number;
  bridge_started_at: string;
  bridge_uptime_seconds: number;
  tool_catalog_generation: string;
  tool_catalog_loaded_at: string;
  request_observed_at: string;
  request_id: string;
  session_fingerprint: string;
  transport_type: "streamable_http";
  last_successful_tool_call_at: string;
  last_tool_error: string;
  last_tool_error_code: number | null;
  last_tool_error_message: string;
  last_tool_error_observed_at: string;
  suspected_failure_layer: string;
  suggested_next_action: string;
  connector_identity: ConnectorIdentitySnapshot;
};

export class BridgeRuntimeDiagnostics {
  private lastSuccessfulToolCallAt = "";
  private lastToolError = "";
  private lastToolErrorCode: number | null = null;
  private lastToolErrorMessage = "";
  private lastToolErrorObservedAt = "";
  private readonly toolCatalogGeneration: string;

  constructor(
    private readonly input: {
      startedAt: string;
      buildTimestamp: string;
      transportType?: "streamable_http";
    }
  ) {
    this.toolCatalogGeneration = buildToolCatalogDiagnostic({
      startedAt: input.startedAt,
      buildTimestamp: input.buildTimestamp,
      toolCatalog
    }).tool_catalog_hash;
  }

  snapshot(request?: RequestTelemetryContext): BridgeObservabilitySnapshot {
    const telemetry = request ?? getRequestTelemetry();
    const suspected = this.suspectedFailureLayer();
    return {
      bridge_process_id: process.pid,
      bridge_started_at: this.input.startedAt,
      bridge_uptime_seconds: Math.max(0, Math.floor((Date.now() - Date.parse(this.input.startedAt)) / 1000)),
      tool_catalog_generation: this.toolCatalogGeneration,
      tool_catalog_loaded_at: this.input.startedAt,
      request_observed_at: new Date().toISOString(),
      request_id: telemetry?.request_id ?? "",
      session_fingerprint: telemetry?.session_fingerprint ?? "",
      transport_type: this.input.transportType ?? "streamable_http",
      last_successful_tool_call_at: this.lastSuccessfulToolCallAt,
      last_tool_error: this.lastToolError,
      last_tool_error_code: this.lastToolErrorCode,
      last_tool_error_message: this.lastToolErrorMessage,
      last_tool_error_observed_at: this.lastToolErrorObservedAt,
      suspected_failure_layer: suspected,
      suggested_next_action: suggestedActionForLayer(suspected),
      connector_identity: buildConnectorIdentitySnapshot()
    };
  }

  recordSuccess(): void {
    this.lastSuccessfulToolCallAt = new Date().toISOString();
  }

  recordToolError(input: {
    error_type: string;
    error_code?: number | null;
    error_message: string;
    suspected_failure_layer?: string;
  }): void {
    this.lastToolError = input.error_type;
    this.lastToolErrorCode = input.error_code ?? null;
    this.lastToolErrorMessage = input.error_message;
    this.lastToolErrorObservedAt = new Date().toISOString();
  }

  async recordSessionEvent(repoRoots: Array<{ repo_id: string; root: string }>, input: {
    event_type: ToolSessionFailureType;
    severity: "info" | "warning" | "error";
    summary: string;
    evidence: Record<string, string | number | boolean | null>;
    suggested_next_action: string;
    error_code?: number | null;
    error_message?: string;
  }): Promise<void> {
    this.recordToolError({
      error_type: input.event_type,
      error_code: input.error_code,
      error_message: input.error_message ?? input.summary
    });
    await Promise.all(repoRoots.map((repo) => appendSessionEvent(repo.root, {
      event_id: `${repo.repo_id}:${input.event_type}:${Date.now()}`,
      event_type: input.event_type,
      repo_id: repo.repo_id,
      severity: input.severity,
      observed_at: new Date().toISOString(),
      summary: input.summary,
      evidence: input.evidence,
      suggested_next_action: input.suggested_next_action,
      acknowledgement_policy: "Session events are unresolved until a future explicit acknowledgement path marks them read.",
      dedupe_key: `${repo.repo_id}:${input.event_type}:${input.evidence.request_id ?? input.evidence.status_code ?? "state"}`
    })));
  }

  private suspectedFailureLayer(): string {
    if (!this.lastToolError) {
      return "none_observed";
    }
    if (this.lastToolError === "invalid_json_rpc_request") {
      return "json_rpc_request";
    }
    if (this.lastToolError === "transport_disconnect") {
      return "transport";
    }
    if (this.lastToolError === "tool_timeout") {
      return "request_timeout_or_cancellation";
    }
    if (this.lastToolError === "tool_session_terminated") {
      return "client_mcp_session";
    }
    return "unknown_tool_session";
  }
}

export function sessionFingerprint(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function appendSessionEvent(repoRoot: string, event: ToolSessionEvent): Promise<void> {
  const eventPath = join(repoRoot, EVENT_LOG_PATH);
  const tmpPath = `${eventPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(join(repoRoot, ".chatgpt/events"), { recursive: true });
    const existing = await readExisting(eventPath);
    const rows = [...existing, JSON.stringify(event)];
    await writeFile(tmpPath, rows.join("\n") + "\n", "utf8");
    await rename(tmpPath, eventPath);
  } catch {
    // Session observability is diagnostic only; it must not break MCP traffic.
  }
}

async function readExisting(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function suggestedActionForLayer(layer: string): string {
  switch (layer) {
    case "client_mcp_session":
      return "retry repo_list_roots in a fresh MCP session; if repeated, restart the connector";
    case "json_rpc_request":
      return "retry the tool call; if repeated, refresh ChatGPT connector state";
    case "transport":
      return "retry once, then check bridge /health and connector network path";
    case "request_timeout_or_cancellation":
      return "retry with a smaller request or check for timeout pressure";
    case "unknown_tool_session":
      return "check bridge_observability, /health, and recent durable events before blaming the runner";
    default:
      return "observe_only";
  }
}
