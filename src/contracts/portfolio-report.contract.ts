import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";
import { PortfolioActionActivitySchema, PortfolioActionLedgerEntrySchema } from "./portfolio-action.contract.js";
import { PortfolioConsoleStateSchema } from "./portfolio-console-state.contract.js";

export const PortfolioReportInputSchema = RepoInputSchema.extend({
  topics: z.array(z.string().min(1).max(100)).max(12).optional()
    .describe("Optional report topics such as active work, risks, research, or next slices."),
  project_ids: z.array(z.string().min(1).max(100)).max(30).optional()
    .describe("Optional exact project-memory ids to include."),
  include_paused: z.boolean().optional().describe("Include paused projects and experiments."),
  max_actions: z.number().int().min(1).max(40).optional().describe("Maximum selectable actions. Defaults to 20.")
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

export const PortfolioReportResultSchema = z.object({
  ok: z.boolean(), repo_id: z.string(), report_id: z.string(), generated_at: z.string(),
  source_generated_at: z.string(), source_age_days: z.number(), freshness: z.enum(["fresh", "aging", "stale", "unknown"]),
  registry_sources: z.array(z.string()),
  registry_source_counts: z.array(z.object({ path: z.string(), project_count: z.number().int().nonnegative() })),
  title: z.string(), summary: z.string(), topics: z.array(z.string()),
  projects: z.array(PortfolioReportProjectSchema), sections: z.array(PortfolioReportSectionSchema),
  project_workspaces: z.array(PortfolioProjectWorkspaceSchema),
  console_state: PortfolioConsoleStateSchema,
  actions: z.array(PortfolioActionSchema), active_actions: z.array(PortfolioActionLedgerEntrySchema),
  history_actions: z.array(PortfolioActionLedgerEntrySchema),
  recent_activity: z.array(PortfolioActionActivitySchema), hidden_action_count: z.number().int().nonnegative(),
  warnings: z.array(z.string()), next_action: z.string()
});

export type PortfolioReportInput = z.infer<typeof PortfolioReportInputSchema>;
export type PortfolioReportResult = z.infer<typeof PortfolioReportResultSchema>;
