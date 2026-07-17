import { z } from "zod";

export const IdeaCommandSchema = z.object({
  idea_id: z.string().max(160).optional(), raw_phrase: z.string().min(1).max(4000),
  normalized_title: z.string().min(1).max(300),
  status: z.enum(["captured", "watch", "ready_for_slice", "parked", "promoted", "rejected", "snoozed"]),
  related_projects: z.array(z.string().max(120)).max(30), urgency: z.enum(["unknown", "low", "medium", "high"]),
  visibility_target: z.enum(["idea_inbox_only", "chatgpt_first_draft", "codex_slice_candidate", "feeder_candidate", "status_note_candidate", "portfolio_suggestion", "goal"]),
  next_prompt: z.string().max(1000), tags: z.array(z.string().max(60)).max(40),
  source_kind: z.enum(["chatgpt", "field_console", "worker_result", "codex", "research_watch", "experiment"]),
  source_reference: z.string().max(1000).optional(), snooze_until: z.string().datetime().optional(),
  promoted_goal_id: z.string().max(120).optional(), reason: z.string().max(2000).optional()
});

export const IdeaRecordSchema = IdeaCommandSchema.extend({
  idea_id: z.string(), captured_at: z.string(), updated_at: z.string(), dedupe_key: z.string()
});

export const DecisionBundleCommandSchema = z.object({
  bundle_id: z.string().max(160).optional(), idempotency_key: z.string().min(3).max(200),
  operator_notes: z.string().max(4000).optional(), launch_deadline: z.string().datetime(),
  dependencies: z.array(z.object({ action_id: z.string().max(120), depends_on: z.array(z.string().max(120)).max(40) })).max(40).optional(),
  waves: z.array(z.object({ wave: z.number().int().min(0).max(100), mode: z.enum(["parallel", "serial"]), action_ids: z.array(z.string().max(120)).max(40) })).max(40).optional(),
  scope_boundaries: z.array(z.string().max(1000)).max(80).optional(), proof_boundaries: z.array(z.string().max(1000)).max(80).optional(),
  executor_recommendations: z.array(z.object({ action_id: z.string().max(120), executor: z.enum(["hermes", "local", "codex"]), reason: z.string().max(1000) })).max(40).optional()
});

export const DecisionBundleRecordSchema = DecisionBundleCommandSchema.extend({
  bundle_id: z.string(), action_ids: z.array(z.string()), state: z.enum(["pending", "routing", "launched", "partial", "cancelled", "completed"]),
  launch_receipts: z.array(z.string()), cancellation_reason: z.string(), created_at: z.string(), updated_at: z.string()
});

export type IdeaCommand = z.infer<typeof IdeaCommandSchema>;
export type IdeaRecord = z.infer<typeof IdeaRecordSchema>;
export type DecisionBundleCommand = z.infer<typeof DecisionBundleCommandSchema>;
export type DecisionBundleRecord = z.infer<typeof DecisionBundleRecordSchema>;
