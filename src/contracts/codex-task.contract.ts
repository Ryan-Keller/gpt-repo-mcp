import { z } from "zod";
import { GitReviewResultSchema } from "./git-review.contract.js";
import { RepoInputSchema } from "./repo.contract.js";

const NonEmptyStringSchema = z.string().min(1);
const RepoPathListSchema = z.array(z.string().min(1)).default([]);
const InputAssetSchema = z.object({
  filename: z.string().min(1).max(160).describe("Original asset filename. Must be a filename only, not a path."),
  mime_type: z.enum(["image/png", "image/jpeg", "image/webp"]).describe("Allowed image MIME type."),
  content_base64: z.string().min(1).describe("Base64-encoded image bytes. Never echoed in result summaries."),
  description: z.string().min(1).max(500).optional().describe("Optional human-readable asset description.")
});
const InputAssetMetadataSchema = z.object({
  filename: z.string(),
  original_filename: z.string(),
  mime_type: z.enum(["image/png", "image/jpeg", "image/webp"]),
  path: z.string(),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  description: z.string().optional()
});
const CodexRunIdSchema = z.string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z-[a-z0-9][a-z0-9-]{0,79}$/)
  .describe("Stable repo-local Codex run id. Generated when omitted.");

const GoalLaneSchema = z.object({
  enabled: z.boolean().describe("Whether this run participates in the Codex Goal Lane workflow."),
  goal_id: z.string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/)
    .optional()
    .describe("Optional compact stable goal identifier. Do not include secrets, raw prompts, URLs, or payloads."),
  goal_title: z.string()
    .min(1)
    .max(160)
    .optional()
    .describe("Optional short human-readable goal label."),
  mode: z.enum(["goal"]).optional().describe("Goal Lane mode. Currently only compact goal runs are accepted."),
  origin: z.enum(["repo_write_codex_task", "repo_write_codex_tasks_batch"]).optional().describe("Tool route that created the Goal Lane metadata."),
  status_policy: z.enum(["compact"]).optional().describe("Goal Lane status policy. Full payloads are not accepted here.")
}).strict().describe("Bounded compact Goal Lane metadata preserved in run.json for runner pickup.");

export const CodexTaskInputSchema = RepoInputSchema.extend({
  title: NonEmptyStringSchema.describe("Short human-readable task title used in the prompt and generated run id."),
  objective: NonEmptyStringSchema.describe("Concrete implementation objective for Codex."),
  context_summary: z.string().min(1).optional().describe("Short context summary ChatGPT wants Codex to know before editing."),
  inspect_first: RepoPathListSchema.describe("Repo-relative files or globs Codex should inspect before editing."),
  allowed_paths: RepoPathListSchema.describe("Repo-relative files or globs Codex may edit."),
  forbidden_paths: RepoPathListSchema.describe("Repo-relative files or globs Codex must not edit."),
  implementation_scope: z.object({
    include: z.array(z.string().min(1)).default([]),
    exclude: z.array(z.string().min(1)).default([])
  }).optional().describe("Explicit implementation boundaries."),
  input_assets: z.array(InputAssetSchema).default([]).describe("Repo-local input assets to write under this run's inputs folder."),
  acceptance_criteria: z.array(z.string().min(1)).default([]).describe("Criteria Codex should satisfy before finishing."),
  verification_commands: z.array(z.string().min(1)).default([]).describe("Commands Codex should run when feasible and report in RESULT.md."),
  goal_lane: GoalLaneSchema.optional().describe("Optional bounded Codex Goal Lane metadata stored in run.json for runner pickup."),
  run_id: CodexRunIdSchema.optional()
});

export const CodexTaskWriteInputSchema = CodexTaskInputSchema.extend({
  dry_run: z.boolean().optional().describe("For repo_write_codex_task only: render and validate without writing files."),
  reason: z.string().min(1).optional().describe("Short audit reason for writing the task locally.")
});

const CodexTaskBatchSeedSchema = CodexTaskInputSchema.omit({ repo_id: true }).extend({
  reason: z.string().min(1).optional().describe("Optional per-seed audit reason for this Codex task seed.")
});

export const CodexTaskBatchWriteInputSchema = RepoInputSchema.extend({
  seeds: z.array(CodexTaskBatchSeedSchema).min(1).max(5).describe("One to five small Codex task seeds to validate and write as independent queued runs."),
  dry_run: z.boolean().optional().describe("Render and validate every seed without writing files."),
  reason: z.string().min(1).optional().describe("Shared audit reason for writing this batch of task seeds locally.")
});

export const CodexTaskResultSchema = z.object({
  ok: z.literal(true),
  repo_id: z.string(),
  queue_repo_id: z.string().optional(),
  run_id: CodexRunIdSchema,
  prompt_path: z.string(),
  result_path: z.string(),
  manifest_path: z.string(),
  prompt_markdown: z.string(),
  codex_user_prompt: z.string(),
  input_assets: z.array(InputAssetMetadataSchema),
  next_steps: z.array(z.string()),
  warnings: z.array(z.string())
});

export const CodexTaskWriteResultSchema = z.object({
  ok: z.literal(true),
  repo_id: z.string(),
  queue_repo_id: z.string().optional(),
  run_id: CodexRunIdSchema,
  prompt_path: z.string(),
  result_path: z.string(),
  manifest_path: z.string(),
  input_assets: z.array(InputAssetMetadataSchema),
  dry_run: z.boolean(),
  written_paths: z.array(z.string()),
  queued_status: z.enum(["queued", "dry_run"]),
  receipt: z.object({
    run_id: CodexRunIdSchema,
    queued: z.boolean(),
    status: z.enum(["queued", "dry_run"]),
    prompt_path: z.string(),
    result_path: z.string(),
    manifest_path: z.string(),
    written_paths: z.array(z.string())
  }),
  operation_receipt: z.object({}).passthrough().optional(),
  next_steps: z.array(z.string()),
  warnings: z.array(z.string())
});

const CodexTaskBatchCreatedSeedSchema = z.object({
  run_id: CodexRunIdSchema,
  title: z.string(),
  prompt_path: z.string(),
  result_path: z.string(),
  manifest_path: z.string(),
  written_paths: z.array(z.string()),
  queued_status: z.enum(["queued", "dry_run"])
});

export const CodexTaskBatchWriteResultSchema = z.object({
  ok: z.literal(true),
  repo_id: z.string(),
  queue_repo_id: z.string().optional(),
  dry_run: z.boolean(),
  batch_size: z.number().int().positive(),
  max_batch_size: z.number().int().positive(),
  created_run_ids: z.array(CodexRunIdSchema),
  created: z.array(CodexTaskBatchCreatedSeedSchema),
  rejected: z.array(z.object({
    index: z.number().int().nonnegative(),
    title: z.string().optional(),
    run_id: z.string().optional(),
    reason: z.string()
  })),
  written_paths: z.array(z.string()),
  receipt: z.object({
    queued: z.boolean(),
    status: z.enum(["queued", "dry_run"]),
    run_ids: z.array(CodexRunIdSchema),
    prompt_paths: z.array(z.string()),
    written_paths: z.array(z.string())
  }),
  operation_receipt: z.object({}).passthrough().optional(),
  next_steps: z.array(z.string()),
  warnings: z.array(z.string())
});

export const CodexReviewInputSchema = RepoInputSchema.extend({
  run_id: CodexRunIdSchema.describe("Codex run id under .chatgpt/codex-runs."),
  max_files: z.number().int().positive().optional().describe("Maximum git diff files to summarize.")
});

export const CodexRunAndWaitInputSchema = RepoInputSchema.extend({
  run_id: CodexRunIdSchema.describe("Existing repo-local Codex run id under .chatgpt/codex-runs."),
  timeout_seconds: z.number().positive().max(3600).default(600).describe("Maximum seconds to wait for RESULT.md after launching one Codex process."),
  dry_run: z.boolean().default(false).describe("Preview the launch command and paths without starting Codex or creating a lock."),
  review_only: z.boolean().default(false).describe("Only return existing RESULT.md or pending state; never start Codex."),
  recover_stale_lock: z.boolean().default(false).describe("When true, remove a lock only after it is classified stale; active locks are never removed."),
  stale_lock_seconds: z.number().positive().max(86400).default(600).describe("Minimum lock age in seconds before a lock without a live process can be treated as stale.")
});

export const CodexParsedResultSchema = z.object({
  status: z.enum(["completed", "blocked", "unknown"]),
  summary: z.string(),
  changed_files: z.array(z.string()),
  commands_run: z.array(z.string()),
  tests: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  blockers: z.array(z.string()),
  followups: z.array(z.string()),
  raw_text: z.string()
});

export const CodexReviewResultSchema = z.object({
  ok: z.literal(true),
  repo_id: z.string(),
  queue_repo_id: z.string().optional(),
  run_id: CodexRunIdSchema,
  result_path: z.string(),
  result_found: z.boolean(),
  codex_result: CodexParsedResultSchema.optional(),
  git_review: GitReviewResultSchema.optional(),
  next_tool_payloads: GitReviewResultSchema.shape.next_tool_payloads.optional(),
  next_steps: z.array(z.string()),
  warnings: z.array(z.string())
});

export const CodexRunAndWaitResultSchema = z.object({
  ok: z.literal(true),
  repo_id: z.string(),
  queue_repo_id: z.string().optional(),
  run_id: CodexRunIdSchema,
  status: z.enum(["missing_prompt", "existing_result", "dry_run", "locked", "stale_lock", "completed", "failed", "timed_out"]),
  prompt_path: z.string(),
  result_path: z.string(),
  result_text: z.string(),
  stdout_tail: z.string(),
  stderr_tail: z.string(),
  elapsed_seconds: z.number(),
  blockers: z.array(z.string()),
  timed_out: z.boolean(),
  launched: z.boolean(),
  command: z.array(z.string()),
  lock_path: z.string(),
  lock_state: z.enum(["none", "active", "stale", "recovered"]),
  warnings: z.array(z.string())
});

export type CodexTask = z.output<typeof CodexTaskInputSchema>;
export type CodexTaskInput = z.input<typeof CodexTaskInputSchema>;
export type CodexTaskWrite = z.output<typeof CodexTaskWriteInputSchema>;
export type CodexTaskWriteInput = z.input<typeof CodexTaskWriteInputSchema>;
export type CodexTaskResult = z.infer<typeof CodexTaskResultSchema>;
export type CodexTaskWriteResult = z.infer<typeof CodexTaskWriteResultSchema>;
export type CodexTaskBatchWriteInput = z.input<typeof CodexTaskBatchWriteInputSchema>;
export type CodexTaskBatchWriteResult = z.infer<typeof CodexTaskBatchWriteResultSchema>;
export type CodexReviewInput = z.infer<typeof CodexReviewInputSchema>;
export type CodexParsedResult = z.infer<typeof CodexParsedResultSchema>;
export type CodexReviewResult = z.infer<typeof CodexReviewResultSchema>;
export type CodexRunAndWaitInput = z.input<typeof CodexRunAndWaitInputSchema>;
export type CodexRunAndWaitResult = z.infer<typeof CodexRunAndWaitResultSchema>;
