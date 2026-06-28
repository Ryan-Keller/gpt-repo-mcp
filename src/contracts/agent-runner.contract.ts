import { z } from "zod";
import { ConnectorIdentitySnapshotSchema } from "./connector-identity.contract.js";
import { RepoInputSchema } from "./repo.contract.js";

export const AgentRunnerStatusInputSchema = RepoInputSchema.extend({
  heartbeat_stale_seconds: z.number().int().positive().optional()
    .describe("Seconds after which the runner heartbeat is considered stale. Defaults to 60."),
  stale_lock_seconds: z.number().int().positive().optional()
    .describe("Seconds after which RESULT.md.lock is classified as stale. Defaults to 900."),
  live_tail_max_events: z.number().int().positive().max(50).optional()
    .describe("Maximum active-run live tail events to include. Defaults to 15."),
  poll_count: z.number().int().min(1).max(4).optional()
    .describe("Number of fresh internal status polls to perform. Defaults to 1; maximum 4."),
  poll_interval_seconds: z.number().int().min(5).max(15).optional()
    .describe("Seconds to wait between internal polls when poll_count is greater than 1. Defaults to 10."),
  capability_id: z.string().min(1).optional()
    .describe("Optional exact capability id to expand inside capability_summary without returning the full capability catalog."),
  portal_id: z.string().min(1).optional()
    .describe("Optional portal id to hydrate inside the focused town_portal read-only capability surface. Ignored unless capability_id is town_portal."),
  detail: z.enum(["summary", "full"]).optional()
    .describe("Payload detail level. Defaults to summary, which keeps status concise and omits bulky result/event bodies. Use full only when debugging or reviewing detailed evidence.")
});

export const RunLiveTailInputSchema = RepoInputSchema.extend({
  run_id: z.string().min(1).describe("Codex run id under .chatgpt/codex-runs/<run_id>."),
  cursor: z.string().optional().describe("Optional sequence cursor returned by a previous live-tail call."),
  max_events: z.number().int().positive().max(100).optional().describe("Maximum events to return. Defaults to 20.")
});

const CapabilityHandleSchema = z.object({
  capability_id: z.string(),
  status: z.string()
}).passthrough();

const ModuleHandleSchema = z.object({
  module_id: z.string(),
  status: z.string(),
  class: z.string()
}).passthrough();

const BridgeCompassSchema = z.object({
  current_route: z.string(),
  runner_state: z.object({
    runner: z.enum(["alive", "dead", "stale", "unknown"]),
    worker: z.enum(["running", "not_running", "unknown"]),
    runtime_assessment: z.enum(["offline", "idle", "running_active_run", "attention_needed"]),
    pending_count: z.number().int(),
    active_count: z.number().int(),
    stale_lock_count: z.number().int()
  }).passthrough(),
  active_lane: z.object({
    state: z.enum(["active", "queued", "ready_result_review", "idle", "blocked"]),
    run_id: z.string(),
    lane: z.string()
  }).passthrough(),
  latest_ready_result: z.object({
    run_id: z.string(),
    result_status: z.string(),
    result_path: z.string()
  }).passthrough(),
  top_blocker: z.object({
    status: z.enum(["none", "blocked"]),
    source: z.string(),
    summary: z.string()
  }).passthrough(),
  module_handles: z.array(ModuleHandleSchema),
  proof_layer: z.enum(["source-tested", "local-live", "blocked", "unknown"]),
  next_safe_action: z.string(),
  context_budget_hint: z.string()
}).passthrough();

const CapabilityReferenceSummarySchema = z.object({
  expansion: z.object({
    mode: z.enum(["skeletal", "focused", "full"]).optional(),
    detail: z.string().optional(),
    focused: z.boolean().optional(),
    capability_id: z.string().optional(),
    found: z.boolean().optional(),
    full_detail_hint: z.string().optional()
  }).passthrough().optional(),
  bridge_compass: BridgeCompassSchema.optional(),
  capability_toc: z.object({
    state: z.string().optional(),
    capability_count: z.number().int().nonnegative().optional(),
    returned_count: z.number().int().nonnegative().optional(),
    capabilities: z.array(CapabilityHandleSchema).optional()
  }).passthrough().optional(),
  module_registry: z.object({
    state: z.string().optional(),
    module_count: z.number().int().nonnegative().optional(),
    returned_count: z.number().int().nonnegative().optional(),
    modules: z.array(ModuleHandleSchema).optional()
  }).passthrough().optional(),
  ws_bridge_room: z.object({
    state: z.string().optional(),
    current_route: z.literal("repo_runner_status.capability_summary.ws_bridge_room").optional(),
    room_id: z.string().optional(),
    event_log_path: z.literal("shared/state/ws-bridge-room/events.jsonl").optional(),
    event_count: z.number().int().nonnegative().optional(),
    last_event_at: z.string().optional(),
    source_list: z.array(z.string()).optional(),
    recent_events: z.array(z.object({}).passthrough()).optional(),
    proof_boundary: z.string().optional(),
    evidence: z.array(z.string()).optional(),
    safe_operations: z.array(z.string()).optional(),
    blocked_operations: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional()
  }).passthrough().optional()
}).passthrough();

const CentralQueueCoverageSchema = z.object({
  enabled: z.boolean(),
  target_repo_id: z.string(),
  queue_repo_id: z.string(),
  project_runner_required: z.boolean(),
  status: z.string(),
  proof: z.string(),
  guidance: z.string()
}).passthrough();

export const AgentRunnerStatusReferenceResultSchema = z.object({
  ok: z.boolean().optional(),
  repo_id: z.string().optional(),
  detail_level: z.enum(["summary", "full"]).optional(),
  details_truncated: z.boolean().optional(),
  full_detail_hint: z.string().optional(),
  runner: z.enum(["alive", "dead", "stale", "unknown"]).optional(),
  worker: z.enum(["running", "not_running", "unknown"]).optional(),
  runtime_assessment: z.enum(["offline", "idle", "running_active_run", "attention_needed"]).optional(),
  active_run_id: z.string().optional(),
  active_run_ids: z.array(z.string()).optional(),
  pending_count: z.number().int().optional(),
  active_count: z.number().int().optional(),
  stale_lock_count: z.number().int().optional(),
  completed_count: z.number().int().optional(),
  blocked_count: z.number().int().optional(),
  ready_results: z.array(z.object({
    run_id: z.string().optional(),
    status: z.string().optional(),
    result_status: z.string().optional(),
    result_path: z.string().optional(),
    summary: z.string().optional(),
    changed_file_count: z.number().int().nonnegative().optional(),
    key_tests: z.array(z.string()).optional(),
    blocker: z.string().optional(),
    proof_layer: z.string().optional(),
    next_action: z.string().optional(),
    preview_urls: z.array(z.string()).optional()
  }).passthrough()).optional(),
  central_queue: CentralQueueCoverageSchema.optional(),
  capability_summary: CapabilityReferenceSummarySchema.optional(),
  plain_text: z.string().optional(),
  warnings: z.array(z.string()).optional()
}).passthrough();

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

const LockInfoSchema = z.object({}).passthrough();

export const LiveTailEventSchema = z.object({
  run_id: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string(),
  event_type: z.string(),
  summary: z.string(),
  path: z.string().optional(),
  cursor: z.string()
});

const WorkerSlotSchema = z.object({}).passthrough();

const QueueEntrySchema = z.object({}).passthrough();
const RunnerEventSchema = JsonValueSchema;
const StaleLockInfoSchema = z.object({}).passthrough();
const PollHistoryEntrySchema = z.object({
  poll_index: z.number().int().positive(),
  observed_at: z.string(),
  heartbeat_updated_at: z.string(),
  heartbeat_age_seconds: JsonValueSchema,
  event_count: z.number().int(),
  event_cursor: z.string(),
  active_count: z.number().int(),
  active_run_id: z.string(),
  last_run_status: z.string(),
  result_md_exists: z.boolean(),
  preview_urls: z.array(z.string()),
  live_tail_events: z.array(LiveTailEventSchema)
});

export const AgentRunnerStatusResultSchema = z.object({
  ok: z.boolean(),
  repo_id: z.string(),
  detail_level: z.enum(["summary", "full"]),
  details_truncated: z.boolean(),
  full_detail_hint: z.string(),
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
  connector_identity: ConnectorIdentitySnapshotSchema.optional(),
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
  max_parallel_runs: z.number().int().positive(),
  worker_slot_count: z.number().int().nonnegative(),
  active_worker_slots: z.number().int().nonnegative(),
  idle_worker_slots: z.number().int().nonnegative(),
  queued_because_at_capacity: z.boolean(),
  worker_slots: z.array(WorkerSlotSchema),
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
    original_estimate: EvidenceSchema.optional(),
    revised_estimate: EvidenceSchema.optional(),
    effective_estimate: EvidenceSchema.optional(),
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
    status: z.string(),
    result_status: z.string(),
    result_path: z.string(),
    summary: z.string(),
    changed_file_count: z.number().int().nonnegative(),
    key_tests: z.array(z.string()),
    blocker: z.string(),
    proof_layer: z.string(),
    next_action: z.string(),
    result_text: z.string(),
    preview_urls: z.array(z.string())
  })),
  central_queue: CentralQueueCoverageSchema.optional(),
  active_run_live_tail: z.array(LiveTailEventSchema),
  queue_entries: z.array(QueueEntrySchema),
  recent_events: z.array(RunnerEventSchema),
  unresolved_events: z.array(RunnerEventSchema),
  event_log_path: z.string(),
  event_cursor: z.string(),
  event_count: z.number().int(),
  unresolved_event_count: z.number().int(),
  acknowledgement_policy: z.string(),
  poll_count: z.number().int().positive(),
  poll_interval_seconds: z.number().int().nonnegative(),
  monitoring_stop_reason: z.enum(["single_shot", "poll_count_reached", "no_active_run", "terminal_result", "result_md_exists"]),
  poll_history: z.array(PollHistoryEntrySchema),
  capability_summary: z.object({}).passthrough().optional(),
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
