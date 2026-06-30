import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

export const RepoReadModeSchema = z.enum(["tree", "search", "file", "many"]);

export const RepoReadDelegatedToolSchema = z.enum([
  "repo_tree",
  "repo_search",
  "repo_fetch_file",
  "repo_read_many"
]);

export const RepoReadInputSchema = RepoInputSchema.extend({
  mode: RepoReadModeSchema.describe("Read operation: tree, search, file, or many."),
  path: z.string().min(1).optional()
    .describe("Repo-relative path for tree or file mode."),
  paths: z.array(z.string().min(1)).optional()
    .describe("Explicit repo-relative paths for many mode."),
  query: z.string().min(1).optional()
    .describe("Search query for search mode."),
  search_mode: z.enum(["literal", "regex"]).optional()
    .describe("Search interpretation for search mode. Defaults to literal."),
  include_globs: z.array(z.string()).optional(),
  exclude_globs: z.array(z.string()).optional(),
  context_lines: z.number().int().min(0).max(5).optional(),
  max_results: z.number().int().positive().optional(),
  max_depth: z.number().int().positive().optional(),
  page_size: z.number().int().positive().optional(),
  include_files: z.boolean().optional(),
  respect_default_excludes: z.boolean().optional(),
  include_generated: z.boolean().optional(),
  include_dependencies: z.boolean().optional(),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  max_bytes: z.number().int().positive().optional(),
  max_files: z.number().int().positive().optional(),
  max_bytes_per_file: z.number().int().positive().optional(),
  max_total_bytes: z.number().int().positive().optional(),
  override_default_excludes: z.boolean().optional(),
  cursor: z.string().optional()
});

export const RepoReadResultSchema = z.object({
  ok: z.literal(true),
  mode: RepoReadModeSchema,
  delegated_tool: RepoReadDelegatedToolSchema,
  result: z.object({}).passthrough(),
  warnings: z.array(z.string()).default([])
});

export type RepoReadInput = z.infer<typeof RepoReadInputSchema>;
export type RepoReadMode = z.infer<typeof RepoReadModeSchema>;
