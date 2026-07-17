import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HermesIntakeInputSchema, type HermesIntakeInput, type HermesIntakeResult } from "../contracts/hermes-intake.contract.js";
import { redactSensitiveText } from "../runtime/result-envelope.js";
import { validateRepoPath } from "./path-sandbox.js";

const INTAKE_ROOT = "shared/hermes-intake";
const SUBMIT_SCRIPT = "scripts/submit-hermes-intake.ps1";
const TARGET = "hermes-orchestrator" as const;
const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_MAX_OUTPUT_BYTES = 16384;

export type HermesIntakeSpawnResult = {
  status: number | null;
  signal: NodeJS.Signals | string | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  durationMs?: number;
};

export type HermesIntakeSpawner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    shell: false;
    timeoutMs: number;
    maxOutputBytes: number;
  }
) => HermesIntakeSpawnResult | Promise<HermesIntakeSpawnResult>;

export class HermesIntakeService {
  constructor(
    private readonly root: string,
    private readonly spawnSubmit: HermesIntakeSpawner = defaultSpawner,
    private readonly targetRoot: string = root
  ) {}

  async submit(rawInput: HermesIntakeInput): Promise<HermesIntakeResult> {
    const input = HermesIntakeInputSchema.parse(rawInput);
    const started = Date.now();
    const paths = this.pathsFor(input.job_id);
    const board = input.board ?? `hermes-intake-${input.job_id}`;
    const workspace = toHermesWorkspace(this.targetRoot);
    const manifest = {
      title: input.title,
      job_id: input.job_id,
      target_repo_id: input.repo_id,
      mode: "roadmap-to-kanban",
      board,
      intake_file: "INTAKE.md",
      result_file: "RESULT.md",
      workspace,
      created_by: "chatgpt-hermes-intake",
      target: TARGET,
      skillsmith: true,
      preserve_full_context: true,
      create_board: true,
      artifact_links_required: true,
      thread_ids_required_when_available: true,
      notes: [
        "Repository work must inherit this exact workspace; do not create implementation tasks in scratch.",
        "Do not assign a forced skill until the assignee profile proves it is actively loadable.",
        "Do not invent MCP tool names or operations. Cite the inspected bridge contract before adding any external dispatch path.",
        "Do not include secrets, tokens, credential paths, or private connector URLs."
      ]
    };

    await mkdir(join(this.root, ...paths.directory.split("/")), { recursive: true });
    await writeFile(join(this.root, ...paths.manifestPath.split("/")), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(join(this.root, ...paths.intakePath.split("/")), input.intake_markdown, "utf8");

    if (input.submit !== true) {
      const resultText = await this.tryReadResult(paths.resultPath);
      return {
        ok: true,
        repo_id: input.repo_id,
        status: "packet_written",
        job_id: input.job_id,
        board,
        workspace,
        target: TARGET,
        manifest_path: paths.manifestPath,
        intake_path: paths.intakePath,
        result_path: paths.resultPath,
        submitted: false,
        spawned: false,
        exit_code: -1,
        timed_out: false,
        duration_ms: elapsedMs(started),
        stdout_tail: "",
        stderr_tail: "",
        result_read: resultText.length > 0,
        result_text: resultText,
        warnings: []
      };
    }

    const spawnResult = await this.spawnSubmit("powershell", [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SUBMIT_SCRIPT,
      paths.manifestPath
    ], {
      cwd: this.root,
      shell: false,
      timeoutMs: (input.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
      maxOutputBytes: input.max_output_bytes ?? DEFAULT_MAX_OUTPUT_BYTES
    });
    const resultText = await this.tryReadResult(paths.resultPath);
    const timedOut = spawnResult.timedOut === true;
    const exitCode = spawnResult.status ?? -1;
    const warnings = [
      ...(timedOut ? ["HERMES_INTAKE_SUBMIT_TIMED_OUT"] : []),
      ...(exitCode !== 0 ? ["HERMES_INTAKE_SUBMIT_NONZERO_EXIT"] : []),
      ...(resultText.length === 0 ? ["HERMES_INTAKE_RESULT_NOT_READ"] : [])
    ];
    return {
      ok: true,
      repo_id: input.repo_id,
      status: timedOut ? "timed_out" : exitCode === 0 ? "submitted" : "failed",
      job_id: input.job_id,
      board,
      workspace,
      target: TARGET,
      manifest_path: paths.manifestPath,
      intake_path: paths.intakePath,
      result_path: paths.resultPath,
      submitted: true,
      spawned: true,
      exit_code: exitCode,
      timed_out: timedOut,
      duration_ms: spawnResult.durationMs ?? elapsedMs(started),
      stdout_tail: redactSensitiveText(spawnResult.stdout),
      stderr_tail: redactSensitiveText(spawnResult.stderr),
      result_read: resultText.length > 0,
      result_text: resultText,
      warnings
    };
  }

  private pathsFor(jobId: string): {
    directory: string;
    manifestPath: string;
    intakePath: string;
    resultPath: string;
  } {
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(jobId)) {
      throw new Error("job_id must be a lowercase slug with letters, numbers, and dashes.");
    }
    const directory = validateRepoPath(`${INTAKE_ROOT}/${jobId}`);
    return {
      directory,
      manifestPath: `${directory}/manifest.json`,
      intakePath: `${directory}/INTAKE.md`,
      resultPath: `${directory}/RESULT.md`
    };
  }

  private async tryReadResult(resultPath: string): Promise<string> {
    try {
      const text = await readFile(join(this.root, ...resultPath.split("/")), "utf8");
      return redactSensitiveText(text);
    } catch {
      return "";
    }
  }
}

export function toHermesWorkspace(targetRoot: string): string {
  const normalized = targetRoot.trim().replaceAll("\\", "/");
  const driveMatch = /^([a-zA-Z]):\/(.+)$/.exec(normalized);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const path = driveMatch[2].replace(/\/+/g, "/");
    return `dir:/mnt/${drive}/${path}`;
  }
  if (normalized.startsWith("/")) {
    return `dir:${normalized.replace(/\/+/g, "/")}`;
  }
  throw new Error(`Approved repository root cannot be mapped to a Hermes WSL workspace: ${targetRoot}`);
}

async function defaultSpawner(
  command: string,
  args: string[],
  options: { cwd: string; shell: false; timeoutMs: number; maxOutputBytes: number }
): Promise<HermesIntakeSpawnResult> {
  const started = Date.now();
  const child = spawn(command, args, {
    cwd: options.cwd,
    shell: options.shell,
    env: minimalPowerShellEnv()
  });
  const stdout = new CappedOutput(options.maxOutputBytes);
  const stderr = new CappedOutput(options.maxOutputBytes);
  child.stdout.on("data", (chunk) => stdout.append(chunk));
  child.stderr.on("data", (chunk) => stderr.append(chunk));

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, options.timeoutMs);

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timeout));

  return {
    status: exit.code,
    signal: exit.signal,
    stdout: stdout.value(),
    stderr: stderr.value(),
    timedOut,
    durationMs: elapsedMs(started)
  };
}

function minimalPowerShellEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    Path: process.env.Path ?? process.env.PATH ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? process.env.SystemRoot ?? "",
    SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "",
    TEMP: process.env.TEMP ?? "",
    TMP: process.env.TMP ?? ""
  };
}

function elapsedMs(started: number): number {
  return Math.max(0, Date.now() - started);
}

class CappedOutput {
  private text = "";
  truncated = false;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer | string): void {
    this.text += chunk.toString();
    if (Buffer.byteLength(this.text, "utf8") > this.maxBytes) {
      this.truncated = true;
      while (Buffer.byteLength(this.text, "utf8") > this.maxBytes) {
        this.text = this.text.slice(1);
      }
    }
  }

  value(): string {
    return this.text;
  }
}
