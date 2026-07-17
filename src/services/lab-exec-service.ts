import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { LabExecInputSchema, type LabExecInput, type LabExecResult } from "../contracts/lab-exec.contract.js";
import { redactSensitiveText } from "../runtime/result-envelope.js";
import { PathSandbox, validateRepoPath } from "./path-sandbox.js";

const APPROVED_LAB_ROOT = "shared/experiments";
const ALLOWED_EXTENSIONS = [".mjs", ".js"] as const;
const DEFAULT_TIMEOUT_SECONDS = 10;
const DEFAULT_MAX_OUTPUT_BYTES = 16384;
const SHELL_META_PATTERN = /[;&|><`$(){}[\]*?~!"']/;
const BANNED_COMMANDS = new Set([
  "cmd",
  "codex",
  "curl",
  "del",
  "git",
  "npm",
  "npx",
  "powershell",
  "pwsh",
  "rm",
  "rmdir",
  "ssh",
  "wget"
]);

export type LabExecSpawnResult = {
  status: number | null;
  signal: NodeJS.Signals | string | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  durationMs?: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  outputSha256?: string;
};

export type LabExecSpawner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    shell: false;
    timeoutMs: number;
    maxOutputBytes: number;
  }
) => LabExecSpawnResult | Promise<LabExecSpawnResult>;

type PolicyDecision = {
  allowed: boolean;
  argv: string[];
  reasons: string[];
  commandFamily: "node_lab_file" | "rejected";
};

export class LabExecService {
  constructor(
    private readonly root: string,
    private readonly spawnLab: LabExecSpawner = defaultSpawner
  ) {}

  async run(rawInput: LabExecInput): Promise<LabExecResult> {
    const input = LabExecInputSchema.parse(rawInput);
    const timeoutSeconds = input.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS;
    const maxOutputBytes = input.max_output_bytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const started = Date.now();
    const decision = await this.decide(input.command);
    const basePolicy = {
      command_family: decision.commandFamily,
      approved_lab_root: APPROVED_LAB_ROOT,
      shell: "disabled" as const,
      timeout_seconds: timeoutSeconds,
      max_output_bytes: maxOutputBytes,
      rejection_reasons: decision.reasons
    };

    if (!decision.allowed) {
      return {
        ok: true,
        repo_id: input.repo_id,
        status: "rejected",
        allowed: false,
        spawned: false,
        argv: decision.argv,
        cwd_label: "repo_root",
        exit_code: -1,
        signal: "",
        timed_out: false,
        duration_ms: elapsedMs(started),
        stdout_tail: "",
        stderr_tail: "",
        stdout_truncated: false,
        stderr_truncated: false,
        output_sha256: emptyOutputSha256(),
        policy: basePolicy,
        warnings: ["LAB_EXEC_REJECTED_BEFORE_SPAWN"]
      };
    }

    const result = await this.spawnLab(decision.argv[0]!, decision.argv.slice(1), {
      cwd: this.root,
      shell: false,
      timeoutMs: timeoutSeconds * 1000,
      maxOutputBytes
    });
    const timedOut = result.timedOut === true;
    const exitCode = result.status;
    return {
      ok: true,
      repo_id: input.repo_id,
      status: timedOut ? "timed_out" : exitCode === 0 ? "completed" : "failed",
      allowed: true,
      spawned: true,
      argv: decision.argv,
      cwd_label: "repo_root",
      exit_code: exitCode ?? -1,
      signal: result.signal === null ? "" : String(result.signal),
      timed_out: timedOut,
      duration_ms: result.durationMs ?? elapsedMs(started),
      stdout_tail: redactSensitiveText(result.stdout),
      stderr_tail: redactSensitiveText(result.stderr),
      stdout_truncated: result.stdoutTruncated === true,
      stderr_truncated: result.stderrTruncated === true,
      output_sha256: result.outputSha256 ?? hashOutput(result.stdout, result.stderr),
      policy: basePolicy,
      warnings: timedOut ? ["LAB_EXEC_TIMED_OUT"] : []
    };
  }

  private async decide(command: string): Promise<PolicyDecision> {
    const trimmed = command.trim();
    const reasons: string[] = [];
    if (SHELL_META_PATTERN.test(trimmed)) {
      reasons.push("Shell metacharacters, chaining, redirects, pipes, expansion, backgrounding, and quotes are not allowed.");
    }
    const argv = trimmed.split(/\s+/).filter(Boolean);
    const executable = argv[0]?.toLowerCase() ?? "";
    if (argv.length !== 2) {
      reasons.push("Command must be exactly: node <repo-relative lab .mjs/.js file>.");
    }
    if (BANNED_COMMANDS.has(executable) || executable !== "node") {
      reasons.push("Only the node command family is allowed.");
    }
    const labPath = argv[1] ?? "";
    if (!labPath) {
      reasons.push("A repo-relative lab file path is required.");
    } else {
      reasons.push(...this.validateLabPathText(labPath));
      if (reasons.length === 0) {
        reasons.push(...await this.validateResolvedLabPath(labPath));
      }
    }
    return {
      allowed: reasons.length === 0,
      argv,
      reasons,
      commandFamily: reasons.length === 0 ? "node_lab_file" : "rejected"
    };
  }

  private validateLabPathText(path: string): string[] {
    const reasons: string[] = [];
    if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\")) {
      reasons.push("Lab file path must be a POSIX repo-relative path, not absolute or backslash-based.");
    }
    let normalized = "";
    try {
      normalized = validateRepoPath(path);
    } catch {
      reasons.push("Lab file path must not contain traversal.");
    }
    if (normalized && !normalized.startsWith(`${APPROVED_LAB_ROOT}/`)) {
      reasons.push(`Lab file must be under ${APPROVED_LAB_ROOT}/.`);
    }
    if (normalized && !ALLOWED_EXTENSIONS.some((extension) => normalized.endsWith(extension))) {
      reasons.push("Lab file must end in .mjs or .js.");
    }
    return reasons;
  }

  private async validateResolvedLabPath(path: string): Promise<string[]> {
    const reasons: string[] = [];
    try {
      const sandbox = new PathSandbox(this.root);
      const resolved = await sandbox.resolve(path);
      const stats = await lstat(resolved.absolutePath);
      if (!stats.isFile()) {
        reasons.push("Lab path must resolve to a file.");
      }
    } catch {
      reasons.push("Lab file could not be resolved inside the approved repository.");
    }
    return reasons;
  }
}

async function defaultSpawner(
  command: string,
  args: string[],
  options: { cwd: string; shell: false; timeoutMs: number; maxOutputBytes: number }
): Promise<LabExecSpawnResult> {
  const started = Date.now();
  const child = spawn(command, args, {
    cwd: options.cwd,
    shell: options.shell,
    env: minimalNodeEnv()
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

  const hash = createHash("sha256");
  hash.update(stdout.hashText);
  hash.update(stderr.hashText);
  return {
    status: exit.code,
    signal: exit.signal,
    stdout: stdout.value(),
    stderr: stderr.value(),
    timedOut,
    durationMs: elapsedMs(started),
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    outputSha256: hash.digest("hex")
  };
}

function minimalNodeEnv(): NodeJS.ProcessEnv {
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

function emptyOutputSha256(): string {
  return hashOutput("", "");
}

function hashOutput(stdout: string, stderr: string): string {
  const hash = createHash("sha256");
  hash.update(stdout);
  hash.update(stderr);
  return hash.digest("hex");
}

class CappedOutput {
  private text = "";
  hashText = "";
  truncated = false;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer | string): void {
    const value = chunk.toString();
    this.hashText += value;
    this.text += value;
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
