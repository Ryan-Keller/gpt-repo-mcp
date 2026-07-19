import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";
import { PortfolioConsoleStatePatchSchema, PortfolioConsoleStateSchema } from "./portfolio-console-state.contract.js";
import { GoalCommandSchema, GoalRecordSchema } from "./goal-record.contract.js";
import { DecisionBundleCommandSchema, DecisionBundleRecordSchema, IdeaCommandSchema, IdeaRecordSchema } from "./portfolio-intake.contract.js";

export const PortfolioActionStateSchema = z.enum(["available", "routed", "working", "completed", "stopped", "snoozed", "archived"]);

export const PortfolioActionCommandItemSchema = z.object({
  action_id: z.string().min(3).max(80),
  project_id: z.string().min(1).max(120).optional(),
  project_name: z.string().min(1).max(180).optional(),
  title: z.string().min(1).max(300).optional(),
  route: z.string().min(1).max(120).optional(),
  risk: z.enum(["read_only", "approval_required"]).optional(),
  expected_state: PortfolioActionStateSchema.optional()
});

export const PortfolioExecutionRequestSchema = z.object({
  target_repo_id: z.string().min(1).max(120)
    .describe("Approved repository id that owns the work. It must resolve through repo_list_roots."),
  objective: z.string().min(3).max(6000)
    .describe("Bounded objective sent to the existing Hermes off-thread launcher."),
  allowed_paths: z.array(z.string().min(1).max(500)).max(40)
    .describe("Narrow target-repo-relative paths authorized for the transaction. Use an empty array only for read-only work."),
  proof_boundary: z.string().min(3).max(2000),
  work_type: z.enum(["code", "knowledge", "art", "broadcast", "marketing"]),
  satisfaction_gate: z.number().int().min(90).max(95),
  consent_granted: z.boolean().refine((value) => value, "consent_granted must be true")
    .describe("Confirms the operator explicitly approved this bounded launch. It does not grant publication, credentials, destructive cleanup, or broader mutation authority."),
  idempotency_key: z.string().min(3).max(200).optional(),
  executor: z.enum(["hermes", "local", "codex"]).optional(),
  routing_reason: z.string().min(3).max(2000).optional(),
  source_kind: z.enum(["chatgpt", "codex", "field_console", "bridge"]).optional(),
  source_reference: z.string().max(1000).optional(),
  project_id: z.string().max(120).optional(), project_name: z.string().max(180).optional(),
  plan: z.array(z.string().max(1000)).max(80).optional(), dependencies: z.array(z.string().max(120)).max(80).optional(),
  parallel_wave: z.number().int().min(0).max(100).optional(), serial_after: z.array(z.string().max(120)).max(80).optional(),
  privacy_scope: z.enum(["private_local", "private_tailnet"]).optional()
});

export const GoalReviewDecisionSchema = z.object({
  decision: z.enum(["yes", "no"])
    .describe("Operator field decision for a direct goal review packet."),
  instruction: z.string().min(3).max(4000)
    .describe("Plain-language instruction captured from the field decision. YES continues/resumes; NO requests a smaller replacement."),
  requested_by: z.enum(["field_console", "chatgpt", "codex", "bridge"]).optional()
    .describe("Surface that captured the operator decision."),
  create_codex_followup: z.boolean().optional()
    .describe("When true for a direct Codex goal, queue a bounded central Codex follow-up packet from this review decision."),
  idempotency_key: z.string().min(3).max(200).optional()
    .describe("Stable key for the follow-up action/packet so retries do not create duplicate intent.")
});

export const CodexFollowupReceiptSchema = z.object({
  queued: z.boolean(),
  run_id: z.string(),
  queue_repo_id: z.string(),
  target_repo_id: z.string(),
  prompt_path: z.string(),
  result_path: z.string(),
  manifest_path: z.string(),
  written_paths: z.array(z.string()),
  warnings: z.array(z.string())
});

export const PortfolioActionCommandInputSchema = RepoInputSchema.extend({
  operation: z.enum(["route", "working", "complete", "stop", "snooze", "archive", "restore", "sync_console", "register_codex", "update_goal", "capture_idea", "update_idea", "route_bundle", "cancel_bundle"])
    .describe("Batch lifecycle or console-state operation. Stop prevents further routing; it does not claim to terminate a Hermes process."),
  report_id: z.string().max(120).optional(),
  actions: z.array(PortfolioActionCommandItemSchema).max(40),
  reason: z.string().max(1800).optional(),
  receipt_summary: z.string().max(3000).optional(),
  snooze_until: z.string().datetime().optional().describe("Required future ISO timestamp for snooze operations."),
  console_patch: PortfolioConsoleStatePatchSchema.optional().describe("Seen timestamps or saved-playbook change for sync_console."),
  execution: PortfolioExecutionRequestSchema.optional()
    .describe("Optional guarded off-thread launch. Valid only for one route action; omitted lifecycle calls remain ledger-only."),
  goal: GoalCommandSchema.optional().describe("Durable direct-Codex registration or goal heartbeat/update."),
  goal_review: GoalReviewDecisionSchema.optional().describe("Optional field review decision for an update_goal command."),
  idea: IdeaCommandSchema.optional().describe("Capture or lifecycle update using the existing local Idea Inbox."),
  bundle: DecisionBundleCommandSchema.optional().describe("Durable server-side decision bundle for several operator choices.")
}).superRefine((value, context) => {
  if (value.operation === "sync_console" && !value.console_patch) context.addIssue({ code: "custom", path: ["console_patch"], message: "console_patch is required for sync_console" });
  if (!["sync_console", "register_codex", "update_goal", "capture_idea", "update_idea", "cancel_bundle"].includes(value.operation) && value.actions.length === 0) context.addIssue({ code: "custom", path: ["actions"], message: "at least one action is required" });
  if (["register_codex", "update_goal"].includes(value.operation) && !value.goal) context.addIssue({ code: "custom", path: ["goal"], message: "goal is required" });
  if (value.goal_review && value.operation !== "update_goal") context.addIssue({ code: "custom", path: ["goal_review"], message: "goal_review is valid only for update_goal" });
  if (value.goal_review && !value.goal) context.addIssue({ code: "custom", path: ["goal"], message: "goal is required when goal_review is provided" });
  if (["capture_idea", "update_idea"].includes(value.operation) && !value.idea) context.addIssue({ code: "custom", path: ["idea"], message: "idea is required" });
  if (["route_bundle", "cancel_bundle"].includes(value.operation) && !value.bundle) context.addIssue({ code: "custom", path: ["bundle"], message: "bundle is required" });
  if (value.execution && value.operation !== "route") context.addIssue({ code: "custom", path: ["execution"], message: "execution is valid only for route" });
  if (value.execution && value.actions.length !== 1) context.addIssue({ code: "custom", path: ["actions"], message: "execution launches exactly one action" });
  if (value.execution && value.actions[0]?.risk === "approval_required" && value.execution.allowed_paths.length === 0) {
    context.addIssue({ code: "custom", path: ["execution", "allowed_paths"], message: "mutating work requires at least one narrow allowed path" });
  }
});

export const PortfolioExecutionReceiptSchema = z.object({
  ok: z.boolean(),
  goal_id: z.string(),
  action_id: z.string(),
  target_repo_id: z.string(),
  status: z.enum(["started", "resumed", "accepted", "blocked", "readiness_blocked", "failed", "timed_out"]),
  transaction_id: z.string(),
  board: z.string(),
  task_id: z.string(),
  transaction_path: z.string(),
  satisfaction_gate: z.number().int(),
  operator_status: z.string(),
  observed_at: z.string(),
  warnings: z.array(z.string()),
  next_action: z.string()
});

export const PortfolioActionLedgerEntrySchema = z.object({
  action_id: z.string(), project_id: z.string(), project_name: z.string(), title: z.string(),
  route: z.string(), risk: z.string(), state: PortfolioActionStateSchema, report_id: z.string(),
  attempt_count: z.number().int().nonnegative(), updated_at: z.string(), reason: z.string(), receipt_summary: z.string(),
  snooze_until: z.string()
});

export const PortfolioActionActivitySchema = z.object({
  event_id: z.string(), action_id: z.string(), project_id: z.string(), title: z.string(),
  operation: z.string(), from_state: z.string(), to_state: z.string(), observed_at: z.string(),
  reason: z.string(), receipt_summary: z.string()
});

export const PortfolioActionCommandResultSchema = z.object({
  ok: z.boolean(), repo_id: z.string(), operation: z.string(), changed_count: z.number().int(),
  unchanged_count: z.number().int(), entries: z.array(PortfolioActionLedgerEntrySchema),
  recent_activity: z.array(PortfolioActionActivitySchema), observed_at: z.string(),
  ledger_path: z.string(), storage_path: z.string(), console_state: PortfolioConsoleStateSchema.optional(),
  execution_receipts: z.array(PortfolioExecutionReceiptSchema).optional(),
  goal_records: z.array(GoalRecordSchema).optional(),
  codex_followup_receipts: z.array(CodexFollowupReceiptSchema).optional(),
  idea_records: z.array(IdeaRecordSchema).optional(), decision_bundles: z.array(DecisionBundleRecordSchema).optional(),
  warnings: z.array(z.string()), next_action: z.string()
});

export type PortfolioActionState = z.infer<typeof PortfolioActionStateSchema>;
export type PortfolioActionCommandInput = z.infer<typeof PortfolioActionCommandInputSchema>;
export type PortfolioActionLedgerEntry = z.infer<typeof PortfolioActionLedgerEntrySchema>;
export type PortfolioActionActivity = z.infer<typeof PortfolioActionActivitySchema>;
export type PortfolioActionCommandResult = z.infer<typeof PortfolioActionCommandResultSchema>;
export type PortfolioExecutionRequest = z.infer<typeof PortfolioExecutionRequestSchema>;
export type PortfolioExecutionReceipt = z.infer<typeof PortfolioExecutionReceiptSchema>;
export type GoalReviewDecision = z.infer<typeof GoalReviewDecisionSchema>;
export type CodexFollowupReceipt = z.infer<typeof CodexFollowupReceiptSchema>;
