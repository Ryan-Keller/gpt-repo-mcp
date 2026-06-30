import { z } from "zod";
import { PlanningDepthSchema } from "./change-plan.contract.js";
import { DecisionSourceSchema } from "./decision.contract.js";
import { GlobScopeSchema } from "./file.contract.js";
import { NextActionHorizonSchema, NextActionModeSchema } from "./next-action.contract.js";
import { ProjectBriefIncludeSchema } from "./project.contract.js";
import { DefaultReadOnlyRepoInputSchema } from "./repo.contract.js";
import { TaskKindSchema } from "./task.contract.js";

export const ProjectContextModeSchema = z.enum([
  "brief",
  "memory",
  "tasks",
  "decisions",
  "plan",
  "next_action"
]);

export const ProjectContextDelegatedToolSchema = z.enum([
  "repo_project_brief",
  "repo_project_memory",
  "repo_task_inventory",
  "repo_decision_memory",
  "repo_change_plan",
  "repo_next_action"
]);

export const RepoProjectContextInputSchema = DefaultReadOnlyRepoInputSchema
  .merge(GlobScopeSchema)
  .extend({
    mode: ProjectContextModeSchema.describe("Project context operation: brief, memory, tasks, decisions, plan, or next_action."),
    include: z.array(ProjectBriefIncludeSchema).optional(),
    include_archived: z.boolean().optional(),
    labels: z.array(TaskKindSchema).optional(),
    max_results: z.number().int().positive().optional(),
    cursor: z.string().optional(),
    include_sources: z.array(DecisionSourceSchema).optional(),
    goal: z.string().min(1).optional()
      .describe("Required for plan mode."),
    max_files_to_inspect: z.number().int().positive().optional(),
    planning_depth: PlanningDepthSchema.optional(),
    next_action_mode: NextActionModeSchema.optional(),
    horizon: NextActionHorizonSchema.optional()
  });

export const RepoProjectContextResultSchema = z.object({
  ok: z.literal(true),
  mode: ProjectContextModeSchema,
  delegated_tool: ProjectContextDelegatedToolSchema,
  result: z.object({}).passthrough(),
  warnings: z.array(z.string()).default([])
});

export type RepoProjectContextInput = z.infer<typeof RepoProjectContextInputSchema>;
export type ProjectContextMode = z.infer<typeof ProjectContextModeSchema>;
