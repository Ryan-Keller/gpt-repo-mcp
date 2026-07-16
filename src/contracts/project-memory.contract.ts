import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

export const ProjectMemoryInputSchema = RepoInputSchema.extend({
  include_archived: z.boolean().optional().describe("Include archived projects in the dashboard when true.")
});

export const ProjectMemoryProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  phase: z.string(),
  product_track: z.string(),
  confidence: z.string(),
  summary: z.string()
});

export const ProjectMemoryRoadmapItemSchema = z.object({
  project_id: z.string(),
  project_name: z.string(),
  milestone: z.string(),
  state: z.string(),
  next_step: z.string()
});

export const ProjectMemoryPausedIdeaSchema = z.object({
  project_id: z.string(),
  project_name: z.string(),
  title: z.string(),
  reason_paused: z.string(),
  next_tiny_experiment: z.string()
});

export const ProjectMemoryWatchlistItemSchema = z.object({
  project_id: z.string(),
  project_name: z.string(),
  topic: z.string(),
  cadence: z.string(),
  status: z.string()
});

export const ProjectMemoryRecentResultSchema = z.object({
  project_id: z.string(),
  project_name: z.string(),
  date: z.string(),
  summary: z.string(),
  source: z.string()
});

export const ProjectMemoryNextMoveSchema = z.object({
  project_id: z.string(),
  move: z.string()
});

export const ProjectMemoryArtifactSchema = z.object({
  artifact_id: z.string(), project_id: z.string(), project_name: z.string(), title: z.string(),
  kind: z.enum(["image", "video", "audio", "document", "link", "other"]),
  source: z.string(), observed_at: z.string(), mime_type: z.string(), preview_url: z.string(), open_url: z.string()
});

export const ProjectMemoryDashboardResultSchema = z.object({
  ok: z.boolean(),
  repo_id: z.string(),
  memory_root: z.string(),
  source_paths: z.array(z.string()).optional(),
  source_project_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  generated_at: z.string(),
  project_count: z.number().int().nonnegative(),
  active_projects: z.array(ProjectMemoryProjectSummarySchema),
  roadmap: z.array(ProjectMemoryRoadmapItemSchema),
  paused_ideas: z.array(ProjectMemoryPausedIdeaSchema),
  research_watchlist: z.array(ProjectMemoryWatchlistItemSchema),
  recent_results: z.array(ProjectMemoryRecentResultSchema),
  suggested_next_moves: z.array(ProjectMemoryNextMoveSchema),
  artifacts: z.array(ProjectMemoryArtifactSchema),
  dream_report_template_path: z.string(),
  warnings: z.array(z.string())
});

export type ProjectMemoryInput = z.infer<typeof ProjectMemoryInputSchema>;
export type ProjectMemoryDashboardResult = z.infer<typeof ProjectMemoryDashboardResultSchema>;
