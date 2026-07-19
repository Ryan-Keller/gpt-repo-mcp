import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

export const PortfolioAdvisorGenerateInputSchema = RepoInputSchema.extend({
  project_id: z.string().min(1).max(120),
  advisor_id: z.string().min(1).max(80),
  snapshot_id: z.string().min(1).max(500),
  decision: z.enum(["accepted", "declined"]),
  prior_idea_title: z.string().min(1).max(500),
  excluded_titles: z.array(z.string().min(1).max(500)).max(20).default([]),
});

export const PortfolioAdvisorGeneratedCardSchema = z.object({
  project_id: z.string(),
  advisor_id: z.string(),
  name: z.string(),
  focus: z.string(),
  brief: z.string(),
  full: z.string(),
  idea_title: z.string(),
  relations: z.array(z.object({ advisor_id: z.string(), type: z.enum(["supports", "depends_on", "contradicts", "supersedes"]), label: z.string() })),
  snapshot_id: z.string(),
  evidence_fingerprint: z.string(),
  generated_at: z.string(),
  generation_source: z.enum(["evidence_fallback", "model"]),
  evidence_work_ids: z.array(z.string()).min(1),
  dispatch_allowed: z.literal(false),
  translation_boundary: z.string(),
  next_action: z.string(),
});

export type PortfolioAdvisorGenerateInput = z.infer<typeof PortfolioAdvisorGenerateInputSchema>;
export type PortfolioAdvisorGeneratedCard = z.infer<typeof PortfolioAdvisorGeneratedCardSchema>;
