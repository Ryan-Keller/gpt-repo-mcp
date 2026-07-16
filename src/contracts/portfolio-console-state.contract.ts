import { z } from "zod";

export const PortfolioConsolePlaybookSchema = z.object({
  name: z.string().min(1).max(120),
  action_ids: z.array(z.string().min(3).max(80)).max(40),
  mode: z.enum(["verify_then_continue", "verify_only", "continue_safe"]),
  time_box_minutes: z.number().int().min(0).max(480),
  note: z.string().max(1800),
  updated_at: z.string()
});

export const PortfolioConsoleArtifactSchema = z.object({
  artifact_id: z.string().min(1).max(120), project_id: z.string().min(1).max(120), title: z.string().min(1).max(240),
  kind: z.enum(["image", "video", "audio", "document", "link", "other"]),
  source: z.string().min(1).max(1000), observed_at: z.string(), mime_type: z.string().max(120),
  preview_url: z.string().max(2000), open_url: z.string().max(2000)
});

export const PortfolioConsoleStateSchema = z.object({
  version: z.number().int(),
  updated_at: z.string(),
  project_seen: z.array(z.object({ project_id: z.string(), seen_at: z.string() })),
  playbooks: z.array(PortfolioConsolePlaybookSchema),
  artifacts: z.array(PortfolioConsoleArtifactSchema)
});

export const PortfolioConsoleStatePatchSchema = z.object({
  project_seen: z.array(z.object({ project_id: z.string().min(1).max(120), seen_at: z.string().datetime() })).max(40).optional(),
  upsert_playbook: PortfolioConsolePlaybookSchema.omit({ updated_at: true }).optional(),
  delete_playbook: z.string().min(1).max(120).optional(),
  upsert_artifact: PortfolioConsoleArtifactSchema.optional(),
  delete_artifact: z.string().min(1).max(120).optional()
});

export type PortfolioConsoleState = z.infer<typeof PortfolioConsoleStateSchema>;
export type PortfolioConsoleStatePatch = z.infer<typeof PortfolioConsoleStatePatchSchema>;
