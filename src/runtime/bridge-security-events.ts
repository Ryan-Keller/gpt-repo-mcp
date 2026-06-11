import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RootRegistry } from "../services/root-registry.js";
import { redactSensitiveText } from "./result-envelope.js";
import type { CallerClassification } from "./access-control.js";

const EVENT_LOG_PATH = ".chatgpt/events/bridge-events.jsonl";
const EVENT_RETENTION_LIMIT = 500;

export type BridgeSecurityEventType =
  | "auth_missing"
  | "auth_denied"
  | "auth_allowed"
  | "public_safe_status_served"
  | "sensitive_status_redacted"
  | "privileged_action_denied"
  | "privileged_action_allowed"
  | "connector_session_terminated"
  | "connector_session_recovered"
  | "connector_schema_changed"
  | "connector_cache_suspected_stale"
  | "path_token_connector_auth_enabled"
  | "tool_session_terminated"
  | "bridge_restarted"
  | "tool_catalog_refreshed"
  | "transport_disconnect"
  | "tool_timeout"
  | "invalid_json_rpc_request"
  | "unknown_tool_session_failure";

export type BridgeSecurityEventInput = {
  event_type: BridgeSecurityEventType;
  severity: "info" | "warning" | "error";
  caller_classification: CallerClassification;
  operation: string;
  allowed: boolean;
  reason: string;
  evidence?: Record<string, string | number | boolean | null>;
  suggested_next_action: string;
};

export async function appendBridgeSecurityEvent(
  registry: RootRegistry,
  input: BridgeSecurityEventInput
): Promise<void> {
  const repos = registry.list();
  if (repos.length === 0) {
    return;
  }
  await Promise.allSettled(repos.map((repo) => appendEvent(repo.root, repo.repo_id, input)));
}

async function appendEvent(root: string, repoId: string, input: BridgeSecurityEventInput): Promise<void> {
  const now = new Date().toISOString();
  const safeOperation = sanitizeSecurityText(input.operation);
  const safeReason = sanitizeSecurityText(input.reason);
  const event = {
    event_id: `security:${input.event_type}:${now}:${randomUUID().slice(0, 8)}`,
    event_type: input.event_type,
    repo_id: repoId,
    run_id: "",
    result_status: "",
    result_path: "",
    severity: input.severity,
    summary: `${safeOperation} ${input.allowed ? "allowed" : "denied"}: ${safeReason}`,
    observed_at: now,
    timestamp: now,
    created_at: now,
    caller_classification: input.caller_classification,
    operation: safeOperation,
    allowed: input.allowed,
    reason: safeReason,
    evidence: sanitizeEvidence(input.evidence ?? {}),
    suggested_next_action: sanitizeSecurityText(input.suggested_next_action),
    acknowledgement_policy: "Events remain unresolved until an explicit acknowledgement workflow marks them read.",
    acknowledged: false,
    unread: true,
    dedupe_key: `security:${input.event_type}:${input.operation}:${now}:${randomUUID().slice(0, 8)}`,
    retention_policy: `keep_last_${EVENT_RETENTION_LIMIT}`
  };
  const current = await readEventLog(root);
  const retained = [...current, event].slice(-EVENT_RETENTION_LIMIT);
  await writeEventLog(root, retained);
}

async function readEventLog(root: string): Promise<unknown[]> {
  try {
    const raw = await readFile(join(root, EVENT_LOG_PATH), "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    return [];
  }
}

async function writeEventLog(root: string, events: unknown[]): Promise<void> {
  const eventPath = join(root, EVENT_LOG_PATH);
  const tmpPath = `${eventPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(join(root, ".chatgpt/events"), { recursive: true });
  await writeFile(tmpPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  await rename(tmpPath, eventPath);
}

function sanitizeSecurityText(value: string): string {
  return redactSensitiveText(value)
    .replace(/authorization:\s*bearer\s+\S+/gi, "[REDACTED_SECRET]")
    .replace(/\bbearer\s+\S+/gi, "Bearer [REDACTED_SECRET]")
    .replace(/\b(x-bridge-auth-token|x-gpt-repo-auth-token)\s*[:=]\s*\S+/gi, "$1=[REDACTED_SECRET]");
}

function sanitizeEvidence(evidence: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(evidence).map(([key, value]) => [
      key,
      typeof value === "string" ? sanitizeSecurityText(value) : value
    ])
  );
}
