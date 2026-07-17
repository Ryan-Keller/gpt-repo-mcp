import { z } from "zod";

export const GoalExecutorSchema = z.enum(["hermes", "local", "codex"]);
export const GoalStateSchema = z.enum([
  "planned", "launching", "working", "provisional", "reviewing", "accepted",
  "blocked", "cancelled", "archived", "failed", "stale"
]);

export const GoalEventSchema = z.object({
  event_id: z.string(), cursor: z.string(), observed_at: z.string(), event_type: z.string(),
  source: z.enum(["bridge", "hermes", "local", "codex", "operator"]), summary: z.string()
});

export const GoalRecordSchema = z.object({
  version: z.number().int().min(1).max(1), goal_id: z.string(), idempotency_key: z.string(), project_id: z.string(),
  project_name: z.string(), repository_id: z.string(), action_id: z.string(), objective: z.string(),
  source_kind: z.enum(["chatgpt", "codex", "field_console", "bridge"]), source_reference: z.string(),
  plan: z.array(z.string()), dependencies: z.array(z.string()), parallel_wave: z.number().int().nonnegative(),
  serial_after: z.array(z.string()), executor: GoalExecutorSchema, routing_reason: z.string(),
  execution_scope: z.array(z.string()), privacy_scope: z.enum(["private_local", "private_tailnet"]),
  proof_boundary: z.string(), hermes_transaction: z.string(), hermes_board: z.string(), hermes_task: z.string(),
  hermes_cursor: z.string(), codex_arbiter: z.string(), satisfaction_threshold: z.number().int().min(90).max(95),
  satisfaction_score: z.number().min(0).max(100), iteration: z.number().int().nonnegative(),
  unmet_dimensions: z.array(z.string()), evidence: z.array(z.string()), artifacts: z.array(z.string()),
  changed_files: z.array(z.string()), state: GoalStateSchema, provisional_completion: z.boolean(),
  final_acceptance: z.boolean(), cancellation_reason: z.string(), intervention: z.string(), retry_count: z.number().int().nonnegative(),
  created_at: z.string(), updated_at: z.string(), heartbeat_at: z.string(), terminal_at: z.string(),
  events: z.array(GoalEventSchema)
});

export const GoalCommandSchema = z.object({
  goal_id: z.string().max(120).optional(),
  idempotency_key: z.string().min(3).max(200),
  project_id: z.string().min(1).max(120), project_name: z.string().min(1).max(180).optional(),
  repository_id: z.string().min(1).max(120), action_id: z.string().max(120).optional(),
  objective: z.string().min(3).max(6000),
  source_kind: z.enum(["chatgpt", "codex", "field_console", "bridge"]), source_reference: z.string().max(1000).optional(),
  plan: z.array(z.string().min(1).max(1000)).max(80).optional(), dependencies: z.array(z.string().max(120)).max(80).optional(),
  parallel_wave: z.number().int().min(0).max(100).optional(), serial_after: z.array(z.string().max(120)).max(80).optional(),
  executor: GoalExecutorSchema, routing_reason: z.string().min(3).max(2000),
  execution_scope: z.array(z.string().max(500)).max(80).optional(), privacy_scope: z.enum(["private_local", "private_tailnet"]),
  proof_boundary: z.string().min(3).max(2000), codex_arbiter: z.string().max(200).optional(),
  satisfaction_threshold: z.number().int().min(90).max(95), state: GoalStateSchema.optional(),
  satisfaction_score: z.number().min(0).max(100).optional(), iteration: z.number().int().min(0).optional(),
  unmet_dimensions: z.array(z.string().max(500)).max(80).optional(), evidence: z.array(z.string().max(2000)).max(100).optional(),
  artifacts: z.array(z.string().max(1000)).max(100).optional(), changed_files: z.array(z.string().max(500)).max(200).optional(),
  heartbeat_at: z.string().datetime().optional(), intervention: z.string().max(2000).optional(), cancellation_reason: z.string().max(2000).optional()
});

export type GoalRecord = z.infer<typeof GoalRecordSchema>;
export type GoalCommand = z.infer<typeof GoalCommandSchema>;
