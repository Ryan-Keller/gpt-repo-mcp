import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

export const AgentRunnerStatusInputSchema = RepoInputSchema.extend({
  heartbeat_stale_seconds: z.number().int().positive().optional()
    .describe("Seconds after which the runner heartbeat is considered stale. Defaults to 60."),
  stale_lock_seconds: z.number().int().positive().optional()
    .describe("Seconds after which RESULT.md.lock is classified as stale. Defaults to 900."),
  live_tail_max_events: z.number().int().positive().max(50).optional()
    .describe("Maximum active-run live tail events to include. Defaults to 15.")
});

export const RunLiveTailInputSchema = RepoInputSchema.extend({
  run_id: z.string().min(1).describe("Codex run id under .chatgpt/codex-runs/<run_id>."),
  cursor: z.string().optional().describe("Optional sequence cursor returned by a previous live-tail call."),
  max_events: z.number().int().positive().max(100).optional().describe("Maximum events to return. Defaults to 20.")
});

const JsonValueSchema = z.any();
const EvidenceSchema = z.object({}).catchall(JsonValueSchema);
const RuntimeAssessmentSchema = z.object({
  state: z.enum(["healthy", "probably_working", "uncertain", "stuck", "stale", "failed"]),
  confidence: z.enum(["high", "medium", "low"]),
  stall_risk: z.enum(["low", "medium", "high"]),
  abandonment_risk: z.enum(["low", "medium", "high"]),
  evidence: EvidenceSchema,
  summary: z.string()
});

const LockInfoSchema = z.object({
  run_id: z.string(),
  lock_path: z.string(),
  lock_age_seconds: JsonValueSchema,
  runner_pid: JsonValueSchema,
  result_md_exists: z.boolean()
});

export const LiveTailEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  timestamp: z.string(),
  event_type: z.string(),
  summary: z.string(),
  path: z.string().optional(),
  cursor: z.string()
});

const QueueEntrySchema = z.object({}).passthrough();
const RunnerEventSchema = JsonValueSchema;
const StaleLockInfoSchema = z.object({}).passthrough();

export const AgentRunnerStatusResultSchema = z.object({
  ok: z.boolean(),
  repo_id: z.string(),
  connector_status: z.enum(["unknown", "healthy", "degraded", "terminated", "stale"]),
  last_connector_success_at: z.string(),
  last_connector_error_at: z.string(),
  last_connector_error_kind: z.string(),
  last_successful_tool_call: z.string(),
  last_failed_tool_call: z.string(),
  suspected_cause: z.string(),
  suggested_next_action: z.string(),
  server_started_at: z.string(),
  current_uptime_seconds: z.number().int().nonnegative(),
  tool_catalog_hash: z.string(),
  contract_schema_version: z.string(),
  auth_status: z.string(),
  runner_state: z.enum(["alive", "dead", "stale"]),
  runner: z.enum(["alive", "dead", "stale", "unknown"]),
  worker: z.enum(["running", "not_running", "unknown"]),
  runtime_assessment: z.enum(["offline", "idle", "running_active_run", "attention_needed"]),
  heartbeat_path: z.string(),
  heartbeat_updated_at: z.string(),
  heartbeat_age_seconds: JsonValueSchema,
  heartbeat_status: z.string(),
  runner_pid: JsonValueSchema,
  active_run_id: z.string(),
  active_locks: z.array(LockInfoSchema),
  stale_locks: z.array(StaleLockInfoSchema),
  completed_with_lock_warnings: z.array(LockInfoSchema),
  active_run_ids: z.array(z.string()),
  active_runs: z.array(z.object({
    run_id: z.string(),
    source: z.enum(["heartbeat", "lock", "heartbeat_and_lock"]),
    heartbeat_active: z.boolean(),
    lock_path: z.string(),
    lock_age_seconds: JsonValueSchema,
    runner_pid: JsonValueSchema,
    result_md_exists: z.boolean(),
    runtime_assessment: RuntimeAssessmentSchema
  })),
  pending_count: z.number().int(),
  active_count: z.number().int(),
  stale_lock_count: z.number().int(),
  completed_count: z.number().int(),
  blocked_count: z.number().int(),
  last_run_id: z.string(),
  last_run_status: z.string(),
  ready_results: z.array(z.object({
    run_id: z.string(),
    result_status: z.string(),
    result_path: z.string(),
    result_text: z.string(),
    preview_urls: z.array(z.string())
  })),
  active_run_live_tail: z.array(LiveTailEventSchema),
  queue_entries: z.array(QueueEntrySchema),
  recent_events: z.array(RunnerEventSchema),
  unresolved_events: z.array(RunnerEventSchema),
  event_log_path: z.string(),
  event_cursor: z.string(),
  event_count: z.number().int(),
  unresolved_event_count: z.number().int(),
  acknowledgement_policy: z.string(),
  plain_text: z.string(),
  warnings: z.array(z.string())
});

export type AgentRunnerStatusInput = z.infer<typeof AgentRunnerStatusInputSchema>;
export type AgentRunnerStatusResult = z.infer<typeof AgentRunnerStatusResultSchema>;

export const RunLiveTailResultSchema = z.object({
  ok: z.boolean(),
  repo_id: z.string(),
  run_id: z.string(),
  events: z.array(LiveTailEventSchema),
  next_cursor: z.string(),
  terminal: z.boolean(),
  result_status: z.string(),
  result_path: z.string(),
  warnings: z.array(z.string())
});

export type RunLiveTailInput = z.infer<typeof RunLiveTailInputSchema>;
export type RunLiveTailResult = z.infer<typeof RunLiveTailResultSchema>;
