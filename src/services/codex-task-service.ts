import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CodexTaskBatchWriteInputSchema, CodexTaskInputSchema, CodexTaskWriteInputSchema, type CodexTask, type CodexTaskBatchWriteInput, type CodexTaskBatchWriteResult, type CodexTaskInput, type CodexTaskResult, type CodexTaskWrite, type CodexTaskWriteInput, type CodexTaskWriteResult } from "../contracts/codex-task.contract.js";
import { FileWriter } from "./file-writer.js";
import { PathSandbox, validateRepoPath } from "./path-sandbox.js";
import { WritePolicy } from "./write-policy.js";

const CODEX_RUN_DIR = ".chatgpt/codex-runs";
const INPUT_ASSET_MAX_BYTES = 5_000_000;
const CODEX_TASK_BATCH_MAX_SIZE = 5;
export const ACTIVE_EXECUTION_PERIOD_REMINDER = "The user is currently present. This conversation is an execution opportunity. Inspect active, queued, completed, and blocked work; capture new opportunities; queue bounded follow-up packets when possible; declare blocked execution paths immediately.";

export class CodexTaskService {
  private readonly writer: FileWriter;

  constructor(
    private readonly root: string,
    sandbox: PathSandbox,
    private readonly policy: WritePolicy,
    private readonly now: () => Date = () => new Date()
  ) {
    this.writer = new FileWriter(root, sandbox, policy);
  }

  prepare(rawInput: CodexTaskInput): CodexTaskResult {
    const input = CodexTaskInputSchema.parse(rawInput);
    const runId = input.run_id ?? createRunId(input.title, this.now());
    const paths = codexRunPaths(runId);
    const inputAssets = normalizeInputAssets(input, runId);
    const promptMarkdown = renderPrompt(input, runId, paths, inputAssets);
    return {
      ok: true,
      repo_id: input.repo_id,
      run_id: runId,
      prompt_path: paths.promptPath,
      result_path: paths.resultPath,
      manifest_path: paths.manifestPath,
      prompt_markdown: promptMarkdown,
      codex_user_prompt: `Implement ${paths.promptPath}`,
      input_assets: inputAssets.map((asset) => asset.metadata),
      next_steps: [
        "Give codex_user_prompt to Codex, or ask ChatGPT to write this task locally with repo_write_codex_task.",
        "After Codex finishes, run repo_codex_review for this run_id to review RESULT.md and the git diff."
      ],
      warnings: []
    };
  }

  async write(rawInput: CodexTaskWriteInput): Promise<CodexTaskWriteResult> {
    const input = CodexTaskWriteInputSchema.parse(rawInput);
    const prepared = this.prepare(input);
    const normalizedAssets = normalizeInputAssets(input, prepared.run_id);
    const dryRun = input.dry_run ?? false;
    await assertRunDoesNotExist(this.root, prepared.run_id);
    const manifest = renderManifest(input, prepared);
    const inputManifestPath = `.chatgpt/codex-runs/${prepared.run_id}/inputs/manifest.json`;
    const inputManifest = `${JSON.stringify({
      schema_version: 1,
      run_id: prepared.run_id,
      assets: prepared.input_assets
    }, null, 2)}\n`;
    const writtenPaths: string[] = [];
    const warnings: string[] = [...prepared.warnings];

    const promptWrite = await this.writer.write({
      path: prepared.prompt_path,
      action: "write",
      content: prepared.prompt_markdown,
      create_dirs: true,
      dry_run: dryRun,
      reason: input.reason
    });
    warnings.push(...promptWrite.warnings);
    if (!dryRun && promptWrite.changed) {
      writtenPaths.push(prepared.prompt_path);
    }

    const manifestWrite = await this.writer.write({
      path: prepared.manifest_path,
      action: "write",
      content: manifest,
      create_dirs: true,
      dry_run: dryRun,
      reason: input.reason
    });
    warnings.push(...manifestWrite.warnings);
    if (!dryRun && manifestWrite.changed) {
      writtenPaths.push(prepared.manifest_path);
    }

    for (const asset of normalizedAssets) {
      this.policy.assertAllowed({
        path: asset.metadata.path,
        bytes: asset.bytes.length,
        action: "write"
      });
      if (!dryRun) {
        const absolutePath = join(this.root, asset.metadata.path);
        await mkdir(join(this.root, `.chatgpt/codex-runs/${prepared.run_id}/inputs`), { recursive: true });
        await writeFile(absolutePath, asset.bytes);
        writtenPaths.push(asset.metadata.path);
      }
    }

    if (prepared.input_assets.length > 0) {
      const inputManifestWrite = await this.writer.write({
        path: inputManifestPath,
        action: "write",
        content: inputManifest,
        create_dirs: true,
        dry_run: dryRun,
        reason: input.reason
      });
      warnings.push(...inputManifestWrite.warnings);
      if (!dryRun && inputManifestWrite.changed) {
        writtenPaths.push(inputManifestPath);
      }
    }

    const queuedStatus = dryRun ? "dry_run" : "queued";
    return {
      ok: true,
      repo_id: prepared.repo_id,
      run_id: prepared.run_id,
      prompt_path: prepared.prompt_path,
      result_path: prepared.result_path,
      manifest_path: prepared.manifest_path,
      input_assets: prepared.input_assets,
      dry_run: dryRun,
      written_paths: writtenPaths,
      queued_status: queuedStatus,
      receipt: {
        run_id: prepared.run_id,
        queued: !dryRun,
        status: queuedStatus,
        prompt_path: prepared.prompt_path,
        result_path: prepared.result_path,
        manifest_path: prepared.manifest_path,
        written_paths: writtenPaths
      },
      next_steps: [
        "Use repo_runner_status or repo_list_roots.runner_status to observe pickup and ready_results.",
        "If the connector drops after this receipt, call repo_last_write or status to recover the written paths."
      ],
      warnings
    };
  }

  async writeBatch(rawInput: CodexTaskBatchWriteInput): Promise<CodexTaskBatchWriteResult> {
    const input = CodexTaskBatchWriteInputSchema.parse(rawInput);
    const dryRun = input.dry_run ?? false;
    const warnings: string[] = [];
    const rejected: CodexTaskBatchWriteResult["rejected"] = [];
    const preparedSeeds = input.seeds.map((seed, index) => {
      const prepared = this.prepare({ ...seed, repo_id: input.repo_id });
      return { index, seed, prepared };
    });

    const runIds = new Map<string, number>();
    const titleKeys = new Map<string, number>();
    for (const preparedSeed of preparedSeeds) {
      const existingRunIndex = runIds.get(preparedSeed.prepared.run_id);
      if (existingRunIndex !== undefined) {
        rejected.push({
          index: preparedSeed.index,
          title: preparedSeed.seed.title,
          run_id: preparedSeed.prepared.run_id,
          reason: `Duplicate run_id in batch; first seen at index ${existingRunIndex}.`
        });
      } else {
        runIds.set(preparedSeed.prepared.run_id, preparedSeed.index);
      }

      const titleKey = slugify(preparedSeed.seed.title);
      const existingTitleIndex = titleKeys.get(titleKey);
      if (existingTitleIndex !== undefined) {
        rejected.push({
          index: preparedSeed.index,
          title: preparedSeed.seed.title,
          run_id: preparedSeed.prepared.run_id,
          reason: `Duplicate equivalent title in batch; first seen at index ${existingTitleIndex}.`
        });
      } else {
        titleKeys.set(titleKey, preparedSeed.index);
      }
    }

    await Promise.all(preparedSeeds.map(async (preparedSeed) => {
      try {
        await assertRunDoesNotExist(this.root, preparedSeed.prepared.run_id);
      } catch (error) {
        rejected.push({
          index: preparedSeed.index,
          title: preparedSeed.seed.title,
          run_id: preparedSeed.prepared.run_id,
          reason: error instanceof Error ? error.message : "Codex run already exists and will not be overwritten."
        });
      }
    }));

    if (rejected.length > 0) {
      return {
        ok: true,
        repo_id: input.repo_id,
        dry_run: dryRun,
        batch_size: input.seeds.length,
        max_batch_size: CODEX_TASK_BATCH_MAX_SIZE,
        created_run_ids: [],
        created: [],
        rejected,
        written_paths: [],
        receipt: {
          queued: false,
          status: dryRun ? "dry_run" : "queued",
          run_ids: [],
          prompt_paths: [],
          written_paths: []
        },
        next_steps: [
          "Fix the rejected seeds and retry the whole batch.",
          "Use repo_runner_status or repo_list_roots.runner_status after a successful write to observe pickup."
        ],
        warnings: [...warnings, "Batch rejected before writing any Codex task seeds."]
      };
    }

    const created = [];
    const writtenPaths: string[] = [];
    for (const preparedSeed of preparedSeeds) {
      const result = await this.write({
        ...preparedSeed.seed,
        repo_id: input.repo_id,
        dry_run: dryRun,
        reason: preparedSeed.seed.reason ?? input.reason
      });
      warnings.push(...result.warnings);
      writtenPaths.push(...result.written_paths);
      created.push({
        run_id: result.run_id,
        title: preparedSeed.seed.title,
        prompt_path: result.prompt_path,
        result_path: result.result_path,
        manifest_path: result.manifest_path,
        written_paths: result.written_paths,
        queued_status: result.queued_status
      });
    }

    return {
      ok: true,
      repo_id: input.repo_id,
      dry_run: dryRun,
      batch_size: input.seeds.length,
      max_batch_size: CODEX_TASK_BATCH_MAX_SIZE,
      created_run_ids: created.map((seed) => seed.run_id),
      created,
      rejected: [],
      written_paths: writtenPaths,
      receipt: {
        queued: !dryRun,
        status: dryRun ? "dry_run" : "queued",
        run_ids: created.map((seed) => seed.run_id),
        prompt_paths: created.map((seed) => seed.prompt_path),
        written_paths: writtenPaths
      },
      next_steps: [
        "Use repo_runner_status or repo_list_roots.runner_status to observe pickup and ready_results.",
        "If the connector drops after this receipt, call repo_last_write or status to recover the written paths."
      ],
      warnings
    };
  }
}

async function assertRunDoesNotExist(root: string, runId: string): Promise<void> {
  const runDir = join(root, CODEX_RUN_DIR, runId);
  const existing = await Promise.all([
    exists(join(runDir, "PROMPT.md")),
    exists(join(runDir, "run.json")),
    exists(join(runDir, "RESULT.md")),
    exists(join(runDir, "RESULT.md.lock")),
    exists(join(runDir, "inputs", "manifest.json"))
  ]);
  if (existing.some(Boolean)) {
    throw new Error(`Codex run already exists and will not be overwritten: ${runId}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function codexRunPaths(runId: string) {
  const normalized = validateRepoPath(`${CODEX_RUN_DIR}/${runId}`);
  if (!normalized.startsWith(`${CODEX_RUN_DIR}/`) || normalized.split("/").length !== 3) {
    throw new Error("Invalid Codex run id.");
  }
  return {
    promptPath: `${normalized}/PROMPT.md`,
    resultPath: `${normalized}/RESULT.md`,
    manifestPath: `${normalized}/run.json`
  };
}

function createRunId(title: string, date: Date): string {
  const timestamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-") + "T" + [
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0")
  ].join("") + "Z";
  return `${timestamp}-${slugify(title)}`;
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "codex-task";
}

type NormalizedInputAsset = {
  metadata: {
    filename: string;
    original_filename: string;
    mime_type: "image/png" | "image/jpeg" | "image/webp";
    path: string;
    size_bytes: number;
    sha256: string;
    description?: string;
  };
  bytes: Buffer;
};

function normalizeInputAssets(input: Pick<CodexTask, "input_assets">, runId: string): NormalizedInputAsset[] {
  const used = new Set<string>();
  return input.input_assets.map((asset) => {
    if (/[\\/]/.test(asset.filename) || asset.filename.includes("..")) {
      throw new Error(`Invalid input asset filename: ${asset.filename}`);
    }
    const filename = sanitizeAssetFilename(asset.filename, asset.mime_type);
    const uniqueFilename = uniqueAssetFilename(filename, used);
    const bytes = Buffer.from(asset.content_base64, "base64");
    if (bytes.length === 0 || bytes.toString("base64").replace(/=+$/g, "") !== asset.content_base64.replace(/\s/g, "").replace(/=+$/g, "")) {
      throw new Error(`Invalid base64 content for input asset: ${asset.filename}`);
    }
    if (bytes.length > INPUT_ASSET_MAX_BYTES) {
      throw new Error(`Input asset exceeds size limit: ${asset.filename}`);
    }
    const path = validateRepoPath(`${CODEX_RUN_DIR}/${runId}/inputs/${uniqueFilename}`);
    return {
      metadata: {
        filename: uniqueFilename,
        original_filename: asset.filename,
        mime_type: asset.mime_type,
        path,
        size_bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        ...(asset.description ? { description: asset.description } : {})
      },
      bytes
    };
  });
}

function sanitizeAssetFilename(filename: string, mimeType: "image/png" | "image/jpeg" | "image/webp"): string {
  const fallbackExtension = mimeType === "image/png" ? ".png" : mimeType === "image/jpeg" ? ".jpg" : ".webp";
  const trimmed = filename.trim().toLowerCase();
  const dot = trimmed.lastIndexOf(".");
  const extension = dot >= 0 ? trimmed.slice(dot).replace(/[^a-z0-9.]/g, "") : fallbackExtension;
  const safeExtension = [".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? extension : fallbackExtension;
  const stem = (dot >= 0 ? trimmed.slice(0, dot) : trimmed)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return `${stem || "input-image"}${safeExtension}`;
}

function uniqueAssetFilename(filename: string, used: Set<string>): string {
  if (!used.has(filename)) {
    used.add(filename);
    return filename;
  }
  const dot = filename.lastIndexOf(".");
  const stem = dot >= 0 ? filename.slice(0, dot) : filename;
  const extension = dot >= 0 ? filename.slice(dot) : "";
  let counter = 2;
  while (used.has(`${stem}-${counter}${extension}`)) {
    counter += 1;
  }
  const unique = `${stem}-${counter}${extension}`;
  used.add(unique);
  return unique;
}

function renderPrompt(input: CodexTask, runId: string, paths: ReturnType<typeof codexRunPaths>, inputAssets: NormalizedInputAsset[]): string {
  const forbidden = input.forbidden_paths.length > 0 ? input.forbidden_paths : [
    ".env*",
    ".git/**",
    "node_modules/**",
    "**/node_modules/**",
    "dist/**",
    "**/dist/**",
    "coverage/**",
    "**/coverage/**",
    "test-results/**",
    "**/test-results/**",
    ".chatgpt/** except this run's RESULT.md"
  ];
  return [
    "# Codex Task",
    "",
    `Run ID: ${runId}`,
    "",
    "## Objective",
    input.objective,
    "",
    ...(input.context_summary ? ["## Context Summary", input.context_summary, ""] : []),
    renderInputAssets(inputAssets),
    renderList("Inspect First", input.inspect_first),
    renderList("Allowed Paths", input.allowed_paths),
    renderList("Forbidden Paths", forbidden),
    renderScope(input),
    renderList("Acceptance Criteria", input.acceptance_criteria),
    renderList("Verification Commands", input.verification_commands),
    "## Active Execution Period Reminder",
    "",
    ACTIVE_EXECUTION_PERIOD_REMINDER,
    "",
    "## Completion Contract",
    "",
    "Before your final chat response, write this file:",
    "",
    `\`${paths.resultPath}\``,
    "",
    "Use this exact structure:",
    "",
    "```md",
    "# CODEX_RESULT",
    "",
    "status: completed | blocked",
    `active_execution_period_reminder: ${ACTIVE_EXECUTION_PERIOD_REMINDER}`,
    "summary: <one-line summary>",
    "changed_files:",
    "commands_run:",
    "tests:",
    "acceptance_criteria:",
    "blockers:",
    "followups:",
    "```",
    "",
    "Then print the same result in the Codex chat.",
    "",
    "Do not stage, commit, push, or edit unrelated files.",
    "Do not edit `.chatgpt/**` except this run's `RESULT.md`.",
    ""
  ].filter((section) => section !== "").join("\n");
}

function renderInputAssets(inputAssets: NormalizedInputAsset[]): string {
  if (inputAssets.length === 0) {
    return "";
  }
  return [
    "## Input Assets",
    "",
    ...inputAssets.flatMap((asset) => [
      `- ${asset.metadata.path}`,
      `  - filename: ${asset.metadata.filename}`,
      `  - mime_type: ${asset.metadata.mime_type}`,
      `  - size_bytes: ${asset.metadata.size_bytes}`,
      `  - sha256: ${asset.metadata.sha256}`,
      ...(asset.metadata.description ? [`  - description: ${asset.metadata.description}`] : [])
    ]),
    "",
    "Use the repo-local input asset paths above. Do not rely on chat-only attachments or `/mnt/data`.",
    ""
  ].join("\n");
}

function renderManifest(input: CodexTaskWrite, prepared: CodexTaskResult): string {
  return `${JSON.stringify({
    schema_version: 1,
    repo_id: prepared.repo_id,
    run_id: prepared.run_id,
    title: input.title,
    objective: input.objective,
    prompt_path: prepared.prompt_path,
    result_path: prepared.result_path,
    input_assets: prepared.input_assets,
    inspect_first: input.inspect_first,
    allowed_paths: input.allowed_paths,
    forbidden_paths: input.forbidden_paths,
    verification_commands: input.verification_commands,
    created_at: prepared.run_id.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z/)?.[0] ?? null
  }, null, 2)}\n`;
}

function renderList(title: string, values: readonly string[]): string {
  if (values.length === 0) {
    return "";
  }
  return [`## ${title}`, "", ...values.map((value) => `- ${value}`), ""].join("\n");
}

function renderScope(input: CodexTask): string {
  if (!input.implementation_scope || (input.implementation_scope.include.length === 0 && input.implementation_scope.exclude.length === 0)) {
    return "";
  }
  return [
    "## Implementation Scope",
    "",
    ...(input.implementation_scope.include.length > 0 ? ["Include:", ...input.implementation_scope.include.map((value) => `- ${value}`), ""] : []),
    ...(input.implementation_scope.exclude.length > 0 ? ["Exclude:", ...input.implementation_scope.exclude.map((value) => `- ${value}`), ""] : [])
  ].join("\n");
}
