import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

export const BridgeConciergeInputSchema = RepoInputSchema.extend({
  request: z.string().min(1).describe("User-facing intention or question, such as 'How is visual streaming?' or 'What happened overnight?'"),
  include_evidence: z.boolean().optional().describe("Include bounded repo-relative evidence paths and notes when true. Defaults to true.")
});

export const BridgeConciergeEvidenceSchema = z.object({
  path: z.string(),
  note: z.string()
});

export const BridgeConciergeDestinationSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["project", "capability", "experiment", "roadmap", "artifact", "workspace"]),
  status: z.string(),
  phase: z.string(),
  product_track: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  match_confidence: z.enum(["high", "medium", "low"]),
  match_reason: z.string()
});

export const BridgeConciergeNextToolHintSchema = z.object({
  tool: z.string(),
  reason: z.string(),
  stop_condition: z.string()
});

export const BridgeConciergeResultSchema = z.object({
  ok: z.boolean(),
  repo_id: z.string(),
  request: z.string(),
  mode: z.enum(["destination_status", "workspace_digest"]),
  destination: BridgeConciergeDestinationSchema,
  current_status: z.string(),
  latest_progress: z.array(z.string()),
  open_issues: z.array(z.string()),
  recommended_next_action: z.string(),
  known: z.array(z.string()),
  inferred: z.array(z.string()),
  unknown: z.array(z.string()),
  evidence: z.array(BridgeConciergeEvidenceSchema),
  next_tool_hints: z.array(BridgeConciergeNextToolHintSchema),
  plain_text: z.string(),
  warnings: z.array(z.string())
});

export type BridgeConciergeInput = z.infer<typeof BridgeConciergeInputSchema>;
export type BridgeConciergeResult = z.infer<typeof BridgeConciergeResultSchema>;
