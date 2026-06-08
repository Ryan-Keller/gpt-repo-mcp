import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { Writable } from "node:stream";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CodexRunAndWaitInputSchema, type CodexRunAndWaitInput, type CodexRunAndWaitResult } from "../contracts/codex-task.contract.js";
import { redactSensitiveText } from "../runtime/result-envelope.js";
import { codexRunPaths } from "./codex-task-service.js";

const CODEX_COMMAND = ["npx", "--no-install", "@openai/codex", "exec", "-"] as const;
const TAIL_LIMIT = 8000;
const POLL_INTERVAL_MS = 250;

export type CodexProcess = {
  stdout: Readable;
  stderr: Readable;
  stdin?: Writable;
  pid?: number;
  kill: () => boolean;
  once: (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown;
};
export type CodexSpawner = (command: string, args: string[], options: { cwd: string }) => CodexProcess;

export class CodexRunService {
  constructor(
    private readonly root: string,
    private readonly spawnCodex: CodexSpawner = (command, args, options) => spawn(command, args, {
      cwd: options.cwd,
      shell: process.platform === "win32"
    })
  ) {}

  async runAndWait(rawInput: CodexRunAndWaitInput): Promise<CodexRunAndWaitResult> {
    const input = CodexRunAndWaitInputSchema.parse(rawInput);
    const started = Date.now();
    const paths = codexRunPaths(input.run_id);
    const promptAbsolute = join(this.root, paths.promptPath);
    const resultAbsolute = join(this.root, paths.resultPath);
    const lockPath = `${paths.resultPath}.lock`;
    const lockAbsolute = join(this.root, lockPath);
    const instruction = `Implement ${paths.promptPath}\n`;
    const command = [...CODEX_COMMAND];

    if (!(await exists(promptAbsolute))) {
      return this.result(input, "missing_prompt", started, {
        promptPath: paths.promptPath,
        resultPath: paths.resultPath,
        lockPath,
        command,
        blockers: ["PROMPT.md is missing."],
        warnings: ["CODEX_PROMPT_MISSING"]
      });
    }

    const existing = await readResultIfPresent(resultAbsolute);
    if (existing !== undefined) {
      return this.result(input, "existing_result", started, {
        promptPath: paths.promptPath,
        resultPath: paths.resultPath,
        lockPath,
        command,
        resultText: existing
      });
    }

    if (input.dry_run || input.review_only) {
      const lockInspection = await inspectLock(lockAbsolute, input.stale_lock_seconds);
      return this.result(input, "dry_run", started, {
        promptPath: paths.promptPath,
        resultPath: paths.resultPath,
        lockPath,
        command,
        lockState: lockInspection.state,
        blockers: lockInspection.state === "active"
          ? ["A lock file exists and appears active; review_only will not launch Codex."]
          : lockInspection.state === "stale"
            ? ["A stale lock file exists; review_only will not recover or launch Codex."]
            : undefined,
        warnings: [
          input.review_only ? "CODEX_REVIEW_ONLY_NO_LAUNCH" : "CODEX_DRY_RUN_NO_LAUNCH",
          ...lockInspection.warnings
        ]
      });
    }

    const lock = await tryCreateLock(lockAbsolute, {
      repo_id: input.repo_id,
      run_id: input.run_id,
      command,
      created_at: new Date().toISOString()
    });
    if (!lock.acquired) {
      const lockInspection = await inspectLock(lockAbsolute, input.stale_lock_seconds);
      if (lockInspection.state === "stale") {
        if (!input.recover_stale_lock) {
          return this.result(input, "stale_lock", started, {
            promptPath: paths.promptPath,
            resultPath: paths.resultPath,
            lockPath,
            command,
            lockState: "stale",
            blockers: [
              "A stale lock file exists for this run.",
              "Call codex_run_and_wait again with recover_stale_lock: true to remove only this stale lock and launch one Codex process."
            ],
            warnings: ["CODEX_RUN_LOCK_STALE", ...lockInspection.warnings]
          });
        }
        await rm(lockAbsolute, { force: true });
        const recoveredLock = await tryCreateLock(lockAbsolute, {
          repo_id: input.repo_id,
          run_id: input.run_id,
          command,
          created_at: new Date().toISOString(),
          recovered_stale_lock: true,
          previous_lock: lockInspection.metadata
        });
        if (recoveredLock.acquired) {
          lock.acquired = true;
        } else {
          return this.result(input, "locked", started, {
            promptPath: paths.promptPath,
            resultPath: paths.resultPath,
            lockPath,
            command,
            lockState: "active",
            blockers: ["A lock file was recreated before stale-lock recovery could acquire it."],
            warnings: ["CODEX_RUN_LOCK_RACE"]
          });
        }
      } else {
        return this.result(input, "locked", started, {
          promptPath: paths.promptPath,
          resultPath: paths.resultPath,
          lockPath,
          command,
          lockState: lockInspection.state,
          blockers: lockInspection.state === "active"
            ? ["A lock file exists and appears active for this run."]
            : ["A lock file already exists for this run, but it is too recent to treat as stale."],
          warnings: [
            lockInspection.state === "active" ? "CODEX_RUN_LOCK_ACTIVE" : "CODEX_RUN_LOCKED",
            ...lockInspection.warnings
          ]
        });
      }
    }

    if (!lock.acquired) {
      return this.result(input, "locked", started, {
        promptPath: paths.promptPath,
        resultPath: paths.resultPath,
        lockPath,
        command,
        lockState: "active",
        blockers: ["A lock file already exists for this run."],
        warnings: ["CODEX_RUN_LOCKED"]
      });
    }

    let processExited = false;
    const stdoutTail = new TailBuffer();
    const stderrTail = new TailBuffer();
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let child: CodexProcess | undefined;

    try {
      child = this.spawnCodex(CODEX_COMMAND[0], [...CODEX_COMMAND.slice(1)], { cwd: this.root });
      child.stdout.on("data", (chunk) => stdoutTail.append(chunk));
      child.stderr.on("data", (chunk) => stderrTail.append(chunk));
      child.once("exit", (code, signal) => {
        processExited = true;
        exitCode = code;
        exitSignal = signal;
      });
      await updateLock(lockAbsolute, {
        repo_id: input.repo_id,
        run_id: input.run_id,
        command,
        created_at: new Date().toISOString(),
        recovered_stale_lock: input.recover_stale_lock,
        pid: child.pid
      });
      child.stdin?.end(instruction);

      const deadline = started + input.timeout_seconds * 1000;
      while (Date.now() <= deadline) {
        const resultText = await readResultIfPresent(resultAbsolute);
        if (resultText !== undefined) {
          return this.result(input, "completed", started, {
            promptPath: paths.promptPath,
            resultPath: paths.resultPath,
            lockPath,
            command,
            lockState: input.recover_stale_lock ? "recovered" : "active",
            resultText,
            stdoutTail: stdoutTail.value(),
            stderrTail: stderrTail.value(),
            launched: true
          });
        }
        if (processExited) {
          return this.result(input, "failed", started, {
            promptPath: paths.promptPath,
            resultPath: paths.resultPath,
            lockPath,
            command,
            lockState: input.recover_stale_lock ? "recovered" : "active",
            stdoutTail: stdoutTail.value(),
            stderrTail: stderrTail.value(),
            launched: true,
            blockers: [`Codex exited before RESULT.md appeared (code ${exitCode ?? "null"}, signal ${exitSignal ?? "null"}).`],
            warnings: ["CODEX_EXITED_WITHOUT_RESULT"]
          });
        }
        await sleep(POLL_INTERVAL_MS);
      }

      child.kill();
      return this.result(input, "timed_out", started, {
        promptPath: paths.promptPath,
        resultPath: paths.resultPath,
        lockPath,
        command,
        lockState: input.recover_stale_lock ? "recovered" : "active",
        stdoutTail: stdoutTail.value(),
        stderrTail: stderrTail.value(),
        launched: true,
        blockers: [`Timed out after ${input.timeout_seconds} seconds waiting for RESULT.md.`],
        timedOut: true,
        warnings: ["CODEX_RUN_TIMED_OUT"]
      });
    } catch (error) {
      return this.result(input, "failed", started, {
        promptPath: paths.promptPath,
        resultPath: paths.resultPath,
        lockPath,
        command,
        lockState: input.recover_stale_lock ? "recovered" : "active",
        stdoutTail: stdoutTail.value(),
        stderrTail: stderrTail.value(),
        launched: child !== undefined,
        blockers: [error instanceof Error ? error.message : "Unexpected Codex launch error."],
        warnings: ["CODEX_LAUNCH_FAILED"]
      });
    } finally {
      await rm(lockAbsolute, { force: true });
    }
  }

  private result(
    input: ReturnType<typeof CodexRunAndWaitInputSchema.parse>,
    status: CodexRunAndWaitResult["status"],
    started: number,
    values: {
      promptPath: string;
      resultPath: string;
      lockPath: string;
      command: readonly string[];
      lockState?: CodexRunAndWaitResult["lock_state"];
      resultText?: string;
      stdoutTail?: string;
      stderrTail?: string;
      blockers?: string[];
      timedOut?: boolean;
      launched?: boolean;
      warnings?: string[];
    }
  ): CodexRunAndWaitResult {
    const resultText = values.resultText ?? "";
    return {
      ok: true,
      repo_id: input.repo_id,
      run_id: input.run_id,
      status,
      prompt_path: values.promptPath,
      result_path: values.resultPath,
      result_text: redactSensitiveText(resultText),
      stdout_tail: redactSensitiveText(values.stdoutTail ?? ""),
      stderr_tail: redactSensitiveText(values.stderrTail ?? ""),
      elapsed_seconds: secondsSince(started),
      blockers: values.blockers ?? parseBlockers(resultText),
      timed_out: values.timedOut ?? status === "timed_out",
      launched: values.launched ?? false,
      command: [...values.command],
      lock_path: values.lockPath,
      lock_state: values.lockState ?? "none",
      warnings: values.warnings ?? []
    };
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readResultIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function tryCreateLock(path: string, payload: unknown): Promise<{ acquired: boolean }> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    return { acquired: true };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "EEXIST") {
      return { acquired: false };
    }
    throw error;
  }
}

async function updateLock(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function inspectLock(path: string, staleLockSeconds: number): Promise<{
  state: CodexRunAndWaitResult["lock_state"];
  metadata: unknown;
  warnings: string[];
}> {
  let stats;
  try {
    stats = await stat(path);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
      return { state: "none", metadata: undefined, warnings: [] };
    }
    throw error;
  }

  let metadata: unknown;
  const warnings: string[] = [];
  try {
    metadata = JSON.parse(await readFile(path, "utf8"));
  } catch {
    metadata = undefined;
    warnings.push("CODEX_RUN_LOCK_UNREADABLE");
  }

  const ageMs = Date.now() - stats.mtimeMs;
  const ageIsStale = ageMs >= staleLockSeconds * 1000;
  const pid = lockPid(metadata);
  if (pid !== undefined && processIsAlive(pid)) {
    return { state: "active", metadata, warnings: ["CODEX_RUN_LOCK_PROCESS_ACTIVE", ...warnings] };
  }
  if (pid !== undefined) {
    warnings.push("CODEX_RUN_LOCK_PROCESS_MISSING");
  }
  if (ageIsStale) {
    return { state: "stale", metadata, warnings };
  }
  return { state: "active", metadata, warnings: pid === undefined ? ["CODEX_RUN_LOCK_RECENT_NO_PID", ...warnings] : warnings };
}

function lockPid(metadata: unknown): number | undefined {
  if (typeof metadata !== "object" || metadata === null || !("pid" in metadata)) {
    return undefined;
  }
  const pid = (metadata as { pid?: unknown }).pid;
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    return true;
  }
}

function parseBlockers(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === "blockers:");
  if (start < 0) {
    return [];
  }
  const blockers: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[a-z_]+:/i.test(line.trim())) {
      break;
    }
    const trimmed = line.trim();
    if (trimmed) {
      blockers.push(trimmed.startsWith("- ") ? trimmed.slice(2).trim() : trimmed);
    }
  }
  return blockers;
}

function secondsSince(started: number): number {
  return Math.round(((Date.now() - started) / 1000) * 1000) / 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TailBuffer {
  private text = "";

  append(chunk: Buffer | string): void {
    this.text += chunk.toString();
    if (this.text.length > TAIL_LIMIT) {
      this.text = this.text.slice(-TAIL_LIMIT);
    }
  }

  value(): string {
    return this.text;
  }
}
