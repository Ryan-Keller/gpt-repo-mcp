import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";
import { PortfolioActionActivitySchema, PortfolioActionLedgerEntrySchema } from "./portfolio-action.contract.js";
import { PortfolioConsoleStateSchema } from "./portfolio-console-state.contract.js";
import { GoalRecordSchema } from "./goal-record.contract.js";

export const PortfolioReportInputSchema = RepoInputSchema.extend({
  topics: z.array(z.string().min(1).max(100)).max(12).optional()
    .describe("Optional report topics such as active work, risks, research, or next slices."),
  project_ids: z.array(z.string().min(1).max(100)).max(30).optional()
    .describe("Optional exact project-memory ids to include."),
  include_paused: z.boolean().optional().describe("Include paused projects and experiments."),
  advisor_project_id: z.string().min(1).max(100).optional()
    .describe("Optionally generate or reuse one GPT-5.4 High nine-advisor batch for this exact project while returning the normal portfolio."),
  max_actions: z.number().int().min(1).max(30).optional().describe("Page size for selectable actions. Defaults to 20 and never exceeds 30."),
  cursor: z.string().max(120).optional().describe("Opaque continuation cursor returned by the previous portfolio report page.")
});

export const PortfolioReportProjectSchema = z.object({
  id: z.string(), name: z.string(), status: z.string(), phase: z.string(),
  product_track: z.string(), confidence: z.string(), summary: z.string()
});

export const PortfolioReportSectionSchema = z.object({
  topic: z.string(), headline: z.string(), items: z.array(z.string())
});

export const PortfolioActionSchema = z.object({
  action_id: z.string(), project_id: z.string(), project_name: z.string(),
  title: z.string(), rationale: z.string(), source: z.string(),
  route: z.enum(["verify_project", "continue_slice", "research", "review_result", "resume_experiment", "ask_user"]),
  risk: z.enum(["read_only", "approval_required"]),
  prompt: z.string(), target_repo_id: z.string(), launch_ready: z.boolean()
});

export const PortfolioArtifactSchema = z.object({
  artifact_id: z.string(), project_id: z.string(), title: z.string(),
  kind: z.enum(["image", "video", "audio", "document", "link", "other"]),
  source: z.string(), observed_at: z.string(), mime_type: z.string(), preview_url: z.string(), open_url: z.string(),
  previewable: z.boolean()
});

export const PortfolioProjectWorkspaceSchema = z.object({
  id: z.string(), name: z.string(), status: z.string(), phase: z.string(), product_track: z.string(),
  confidence: z.string(), summary: z.string(), latest_evidence_at: z.string(), active_action_count: z.number().int(),
  handled_action_count: z.number().int(), milestones: z.array(z.string()), recent_results: z.array(z.string()),
  next_moves: z.array(z.string()), watch_topics: z.array(z.string()), artifacts: z.array(PortfolioArtifactSchema), reentry_prompt: z.string()
});

export const PortfolioAdvisorRelationSchema = z.object({
  advisor_id: z.string(), type: z.enum(["supports", "depends_on", "contradicts", "supersedes"]), label: z.string()
});

export const PortfolioAdvisorCardSchema = z.object({
  advisor_id: z.string(), name: z.string(), focus: z.string(), brief: z.string(), full: z.string(), idea_title: z.string(),
  kind: z.enum(["actionable", "perspective", "abstain"]),
  control_mode: z.enum(["yes_no", "none"]),
  evidence_work_ids: z.array(z.string()),
  relations: z.array(PortfolioAdvisorRelationSchema)
});

export const PortfolioAdvisorEvidenceProvenanceSchema = z.object({
  source_kind: z.enum(["roadmap", "recent_result", "suggested_next_move", "action_ledger", "goal", "idea"]),
  source_path: z.string(), source_id: z.string(), observed_at: z.string(), detail: z.string()
});

export const PortfolioAdvisorEvidenceWorkItemSchema = z.object({
  work_id: z.string(),
  state: z.enum(["completed", "superseded", "active", "blocked", "open", "unknown"]),
  title: z.string(), detail: z.string(), observed_at: z.string(),
  advisor_eligible: z.boolean(),
  exclusion_reason: z.enum(["", "terminal_state", "owner_dependent", "insufficient_evidence", "generic_process"]),
  provenance: z.array(PortfolioAdvisorEvidenceProvenanceSchema).min(1)
});

export const PortfolioAdvisorEvidenceStatePacketSchema = z.object({
  version: z.number().int().min(1).max(1), project_id: z.string(), source_generated_at: z.string(), states_explicit: z.boolean(),
  completed: z.array(PortfolioAdvisorEvidenceWorkItemSchema),
  superseded: z.array(PortfolioAdvisorEvidenceWorkItemSchema),
  active: z.array(PortfolioAdvisorEvidenceWorkItemSchema),
  blocked: z.array(PortfolioAdvisorEvidenceWorkItemSchema),
  open: z.array(PortfolioAdvisorEvidenceWorkItemSchema),
  unknown: z.array(PortfolioAdvisorEvidenceWorkItemSchema),
  counts: z.object({ completed: z.number().int().nonnegative(), superseded: z.number().int().nonnegative(), active: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), open: z.number().int().nonnegative(), unknown: z.number().int().nonnegative() }),
  eligible_work_ids: z.array(z.string()), translation_boundary: z.string()
});

export const PortfolioAdvisorReportSchema = z.object({
  project_id: z.string(), snapshot_id: z.string(), generated_at: z.string(), evidence_observed_at: z.string(),
  evidence_fingerprint: z.string().min(8),
  freshness: z.enum(["fresh", "aging", "stale", "unknown"]), freshness_label: z.string(),
  advisor_generation_source: z.enum(["model", "evidence_fallback"]),
  advisor_generation_status: z.enum(["generated", "cached", "fallback", "abstained", "not_requested"]),
  advisor_generation_detail: z.string(),
  evidence_state_packet: PortfolioAdvisorEvidenceStatePacketSchema,
  cards: z.array(PortfolioAdvisorCardSchema)
});

export const PortfolioReportResultSchema = z.object({
  ok: z.boolean(), repo_id: z.string(), report_id: z.string(), generated_at: z.string(),
  source_generated_at: z.string(), source_age_days: z.number(), freshness: z.enum(["fresh", "aging", "stale", "unknown"]),
  registry_sources: z.array(z.string()),
  registry_source_counts: z.array(z.object({ path: z.string(), project_count: z.number().int().nonnegative() })),
  title: z.string(), summary: z.string(), topics: z.array(z.string()),
  projects: z.array(PortfolioReportProjectSchema), sections: z.array(PortfolioReportSectionSchema),
  project_workspaces: z.array(PortfolioProjectWorkspaceSchema),
  advisor_reports: z.array(PortfolioAdvisorReportSchema),
  console_state: PortfolioConsoleStateSchema,
  actions: z.array(PortfolioActionSchema), active_actions: z.array(PortfolioActionLedgerEntrySchema),
  history_actions: z.array(PortfolioActionLedgerEntrySchema),
  recent_activity: z.array(PortfolioActionActivitySchema), hidden_action_count: z.number().int().nonnegative(),
  active_goals: z.array(GoalRecordSchema), goal_history: z.array(GoalRecordSchema),
  next_cursor: z.string(), total_action_count: z.number().int().nonnegative(), choice_sufficient: z.boolean(),
  warnings: z.array(z.string()), next_action: z.string()
});

export type PortfolioReportInput = z.infer<typeof PortfolioReportInputSchema>;
export type PortfolioReportResult = z.infer<typeof PortfolioReportResultSchema>;
