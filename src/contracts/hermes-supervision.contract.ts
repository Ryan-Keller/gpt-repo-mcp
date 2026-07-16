import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

export const HermesTransactionIdSchema = z.string()
  .regex(/^offthread-[a-f0-9]{16}$/, "Use the exact offthread-<16 lowercase hex> transaction id.");

export const HermesBoardSlugSchema = z.string()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Use a lowercase dash-separated Hermes board slug.");

export const HermesWatchInputSchema = RepoInputSchema.extend({
  hermes_board: HermesBoardSlugSchema
    .optional()
    .describe("Optional exact Hermes Kanban board slug. Provide a board, transaction, or both."),
  hermes_transaction: HermesTransactionIdSchema
    .optional()
    .describe("Optional exact Hermes off-thread transaction id. Provide a board, transaction, or both."),
  hermes_cursor: z.string()
    .max(240)
    .optional()
    .describe("Cursor returned by the previous watch result. Only newer transaction events are returned."),
  watch_seconds: z.number()
    .int()
    .min(10)
    .max(55)
    .optional()
    .describe("Maximum seconds for this server-side Hermes watch request. Defaults to 45."),
  poll_interval_seconds: z.number()
    .int()
    .min(5)
    .max(15)
    .optional()
    .describe("Seconds between Hermes-specific observations inside this request. Defaults to 10."),
  max_events: z.number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Maximum new transaction events returned. Defaults to 12.")
});

export const HermesWatchEventSchema = z.object({
  cursor: z.string(),
  observed_at: z.string(),
  event_type: z.string(),
  source: z.string(),
  summary: z.string()
});

export const HermesWatchTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  assignee: z.string(),
  status: z.string(),
  priority: z.number().int(),
  created_at: z.number().int(),
  started_at: z.number().int(),
  completed_at: z.number().int(),
  result_present: z.boolean(),
  result_summary: z.string()
});

export const HermesWatchBoardCountSchema = z.object({
  status: z.string(),
  count: z.number().int().nonnegative()
});

export const HermesWatchResultSchema = z.object({
  ok: z.boolean(),
  repo_id: z.string(),
  watch_id: z.string(),
  observed_at: z.string(),
  target_type: z.enum(["board", "transaction", "board_and_transaction"]),
  hermes_board: z.string(),
  hermes_transaction: z.string(),
  state: z.enum(["working", "waiting", "proof_check", "accepted", "stopped", "blocked", "unavailable"]),
  operator_status: z.string(),
  changed: z.boolean(),
  heartbeat: z.boolean(),
  terminal: z.boolean(),
  continue_required: z.boolean(),
  final_response_allowed: z.boolean(),
  stop_reason: z.enum(["changed", "new_event", "terminal", "deadline", "blocked", "unavailable"]),
  poll_count: z.number().int(),
  elapsed_ms: z.number().int(),
  next_cursor: z.string(),
  acceptance_status: z.string(),
  satisfaction_gate: z.number()
    .describe("Configured satisfaction gate, or -1 when no transaction gate is available."),
  board_counts: z.array(HermesWatchBoardCountSchema),
  tasks: z.array(HermesWatchTaskSchema),
  events: z.array(HermesWatchEventSchema),
  request: z.object({
    repo_id: z.string(),
    hermes_board: z.string(),
    hermes_transaction: z.string(),
    watch_seconds: z.number().int(),
    poll_interval_seconds: z.number().int(),
    max_events: z.number().int()
  }),
  warnings: z.array(z.string()),
  next_action: z.string()
});

export const HermesInterventionInputSchema = RepoInputSchema.extend({
  transaction_id: HermesTransactionIdSchema
    .describe("Existing active Hermes off-thread transaction id."),
  intervention_type: z.enum(["correction", "constraint", "verification", "priority", "pause_request", "resume_request"])
    .describe("Bounded steering category. Pause and resume are requests recorded for the worker; they do not kill or start processes."),
  instruction: z.string()
    .min(1)
    .max(6000)
    .describe("Checkpoint instruction to append. Do not include secrets, tokens, credential paths, or private connector URLs."),
  reason: z.string()
    .max(1500)
    .optional()
    .describe("Optional evidence-backed reason for the intervention."),
  expected_evidence: z.string()
    .max(2000)
    .optional()
    .describe("Optional proof Hermes should add before the checkpoint is considered resolved.")
});

export const HermesInterventionResultSchema = z.object({
  ok: z.boolean(),
  status: z.enum(["checkpoint_appended", "rejected"]),
  repo_id: z.string(),
  transaction_id: z.string(),
  intervention_id: z.string(),
  intervention_type: z.string(),
  operator_status: z.string(),
  checkpoint_path: z.string(),
  receipt_path: z.string(),
  observed_at: z.string(),
  next_action: z.string(),
  warnings: z.array(z.string())
});

export const HermesCancelInputSchema = RepoInputSchema.extend({
  transaction_id: HermesTransactionIdSchema.describe("Exact active Hermes off-thread transaction id."),
  reason: z.string().min(3).max(1500).describe("Evidence-backed operator reason for cancellation."),
  dry_run: z.boolean().optional().describe("Validate the transaction and cancellation plan without stopping processes.")
});

export const HermesCancelResultSchema = z.object({
  ok: z.boolean(), status: z.enum(["dry_run", "cancelled", "rejected"]), repo_id: z.string(),
  transaction_id: z.string(), before_status: z.string(), after_status: z.string(),
  stopped_process_count: z.number().int().nonnegative(), receipt_path: z.string(),
  observed_at: z.string(), warnings: z.array(z.string()), next_action: z.string()
});

export const HermesKanbanCommandInputSchema = RepoInputSchema.extend({
  board: HermesBoardSlugSchema.describe("Exact Hermes Kanban board slug."),
  operation: z.enum(["comment", "assign", "block", "schedule", "unblock", "promote", "archive", "create_followup"])
    .describe("Allowlisted Kanban mutation. Archive preserves history; permanent deletion, completion, forced promotion, claim reclaim, and process control are unavailable."),
  task_id: z.string()
    .max(80)
    .optional()
    .describe("Exact existing task id. Required except for create_followup."),
  expected_status: z.string()
    .max(40)
    .optional()
    .describe("Required current task status for optimistic-lock protection on existing-task mutations."),
  instruction: z.string()
    .max(6000)
    .optional()
    .describe("Comment, block reason, scheduling note, or recovery reason, depending on operation."),
  assignee: z.string()
    .max(80)
    .optional()
    .describe("Validated Hermes profile name for assign or create_followup."),
  title: z.string()
    .max(240)
    .optional()
    .describe("Follow-up task title. Required only for create_followup."),
  body: z.string()
    .max(6000)
    .optional()
    .describe("Follow-up task body. Required only for create_followup."),
  block_kind: z.enum(["capability", "dependency", "needs_input", "transient"])
    .optional()
    .describe("Typed Hermes block reason. Required only for block."),
  idempotency_key: z.string()
    .max(160)
    .optional()
    .describe("Stable deduplication key. Required only for create_followup."),
  dry_run: z.boolean()
    .optional()
    .describe("When true, validate and return the guarded command plan without mutating Hermes.")
});

export const HermesKanbanCommandResultSchema = z.object({
  ok: z.boolean(),
  status: z.enum(["dry_run", "executed", "rejected"]),
  repo_id: z.string(),
  board: z.string(),
  operation: z.string(),
  task_id: z.string(),
  before_status: z.string(),
  after_status: z.string(),
  command_summary: z.string(),
  observed_at: z.string(),
  next_action: z.string(),
  warnings: z.array(z.string())
});

export type HermesInterventionInput = z.infer<typeof HermesInterventionInputSchema>;
export type HermesInterventionResult = z.infer<typeof HermesInterventionResultSchema>;
export type HermesCancelInput = z.infer<typeof HermesCancelInputSchema>;
export type HermesCancelResult = z.infer<typeof HermesCancelResultSchema>;
export type HermesKanbanCommandInput = z.infer<typeof HermesKanbanCommandInputSchema>;
export type HermesKanbanCommandResult = z.infer<typeof HermesKanbanCommandResultSchema>;
export type HermesWatchInput = z.infer<typeof HermesWatchInputSchema>;
export type HermesWatchResult = z.infer<typeof HermesWatchResultSchema>;
