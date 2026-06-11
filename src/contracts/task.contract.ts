import { z } from "zod";
import { GlobScopeSchema } from "./file.contract.js";
import { DefaultReadOnlyRepoInputSchema } from "./repo.contract.js";

export const TaskKindSchema = z.enum(["todo", "fixme", "hack", "checkbox", "roadmap"]);

export const TaskInventoryInputSchema = DefaultReadOnlyRepoInputSchema
  .merge(GlobScopeSchema)
  .extend({
    labels: z.array(TaskKindSchema).optional()
      .describe("Optional task kinds to include. Omit this to scan all supported task-like signals."),
    max_results: z.number().int().positive().optional()
      .describe("Maximum number of task signals to return. Omit for the service default."),
    cursor: z.string().optional()
      .describe("Pagination cursor returned by a previous task inventory response.")
  });

export const TaskInventoryItemSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  kind: TaskKindSchema,
  text: z.string(),
  surrounding_context: z.string().optional()
});

export const TaskInventoryResultSchema = z.object({
  tasks: z.array(TaskInventoryItemSchema),
  matched_count: z.number().int().nonnegative(),
  returned_count: z.number().int().nonnegative(),
  scanned_file_count: z.number().int().nonnegative(),
  scan_complete: z.boolean(),
  truncated: z.boolean(),
  next_cursor: z.string().optional(),
  warnings: z.array(z.string()).default([])
});

export type TaskInventoryInput = z.infer<typeof TaskInventoryInputSchema>;
export type TaskKind = z.infer<typeof TaskKindSchema>;
