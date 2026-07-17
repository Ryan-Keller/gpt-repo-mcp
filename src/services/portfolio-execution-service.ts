import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { PortfolioExecutionReceipt, PortfolioExecutionRequest } from "../contracts/portfolio-action.contract.js";
import { redactSensitiveText } from "../runtime/result-envelope.js";

const DEFAULT_LAUNCHER = "D:\\HermesDesktop\\scripts\\hermes-off-thread.ps1";
const DEFAULT_PWSH = "C:\\Users\\Ryan\\AppData\\Local\\Programs\\PowerShell\\7\\pwsh.exe";
const DEFAULT_TIMEOUT_MS = 120_000;

type LaunchProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type LaunchSpawner = (command: string, args: string[], options: { cwd: string; timeoutMs: number }) => Promise<LaunchProcessResult>;

export class PortfolioExecutionService {
  constructor(private readonly options: {
    launcherPath?: string;
    pwshPath?: string;
    timeoutMs?: number;
    spawnLaunch?: LaunchSpawner;
    now?: () => Date;
  } = {}) {}

  async launch(input: {
    repo_id: string;
    action_id: string;
    target_repo_id: string;
    target_repo_root: string;
    execution: PortfolioExecutionRequest;
  }): Promise<PortfolioExecutionReceipt> {
    const goalId = `goal-${createHash("sha256").update(`${input.repo_id}:${input.action_id}:${input.execution.objective}`).digest("hex").slice(0, 16)}`;
    const args = [
      "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", this.options.launcherPath ?? DEFAULT_LAUNCHER,
      "-Command", "Start",
      "-Objective", input.execution.objective,
      "-RepoPath", input.target_repo_root,
      "-ProofBoundary", input.execution.proof_boundary,
      "-WorkType", input.execution.work_type,
      "-SatisfactionGate", String(input.execution.satisfaction_gate),
      "-ConsentGranted",
      "-SkipDesktopReturnDelivery"
    ];
    if (input.execution.allowed_paths.length) args.push("-AllowedPaths", ...input.execution.allowed_paths);

    const processResult = await (this.options.spawnLaunch ?? defaultSpawner)(
      this.options.pwshPath ?? DEFAULT_PWSH,
      args,
      { cwd: input.target_repo_root, timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS }
    );
    const observedAt = (this.options.now ?? (() => new Date()))().toISOString();
    if (processResult.timedOut) return failureReceipt("timed_out", "Hermes launch timed out before returning a transaction receipt.", ["HERMES_OFF_THREAD_LAUNCH_TIMED_OUT"]);
    if (processResult.exitCode !== 0) {
      const detail = redactSensitiveText(processResult.stderr || processResult.stdout).trim().slice(-500);
      return failureReceipt("failed", detail || `Hermes launcher exited ${processResult.exitCode}.`, ["HERMES_OFF_THREAD_LAUNCH_FAILED"]);
    }

    try {
      const parsed = JSON.parse(processResult.stdout.trim()) as Record<string, unknown>;
      const transaction = asRecord(parsed.transaction);
      const plan = asRecord(parsed.plan);
      const transactionId = text(transaction.transaction_id) || text(parsed.transaction_id) || text(plan.transaction_id);
      const status = launchStatus(text(parsed.kind));
      const ok = ["started", "resumed", "accepted"].includes(status);
      return {
        ok,
        goal_id: goalId,
        action_id: input.action_id,
        target_repo_id: input.target_repo_id,
        status,
        transaction_id: transactionId,
        board: text(transaction.board) || text(plan.board),
        task_id: text(transaction.task_id),
        transaction_path: text(transaction.transaction_path) || text(plan.transaction_path),
        satisfaction_gate: number(transaction.satisfaction_gate, input.execution.satisfaction_gate),
        operator_status: text(parsed.operator_status) || text(transaction.operator_status) || operatorStatus(status),
        observed_at: observedAt,
        warnings: ok ? [] : [status === "readiness_blocked" ? "HERMES_JOB_SITE_READINESS_BLOCKED" : "HERMES_OFF_THREAD_LAUNCH_BLOCKED"],
        next_action: ok && transactionId ? "inspect_repo_runner_status_with_capability_id_hermes_kanban_and_the_same_transaction" : "review_launch_blocker_before_retry"
      };
    } catch (error) {
      return failureReceipt("failed", `Hermes returned an unreadable launch receipt: ${error instanceof Error ? error.message : "unknown parse error"}`, ["HERMES_OFF_THREAD_RECEIPT_INVALID"]);
    }

    function failureReceipt(status: "failed" | "timed_out", message: string, warnings: string[]): PortfolioExecutionReceipt {
      return {
        ok: false, goal_id: goalId, action_id: input.action_id, target_repo_id: input.target_repo_id,
        status, transaction_id: "", board: "", task_id: "", transaction_path: "",
        satisfaction_gate: input.execution.satisfaction_gate, operator_status: message, observed_at: observedAt,
        warnings, next_action: "review_launch_blocker_before_retry"
      };
    }
  }
}

function launchStatus(kind: string): PortfolioExecutionReceipt["status"] {
  if (kind.includes("already-accepted")) return "accepted";
  if (kind.includes("resumed")) return "resumed";
  if (kind.includes("readiness-blocked")) return "readiness_blocked";
  if (kind.includes("blocked")) return "blocked";
  if (kind.includes("started")) return "started";
  return "failed";
}

function operatorStatus(status: PortfolioExecutionReceipt["status"]): string {
  if (status === "accepted") return "Accepted.";
  if (status === "started" || status === "resumed") return "Hermes is working.";
  if (status === "readiness_blocked") return "Stopped before dispatch; required job-site capabilities are missing.";
  return "Stopped at a boundary that needs resolution.";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function defaultSpawner(command: string, args: string[], options: { cwd: string; timeoutMs: number }): Promise<LaunchProcessResult> {
  const child = spawn(command, args, { cwd: options.cwd, shell: false, windowsHide: true, env: process.env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = capped(stdout + chunk.toString()); });
  child.stderr.on("data", (chunk) => { stderr = capped(stderr + chunk.toString()); });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  }).finally(() => clearTimeout(timeout));
  return { exitCode, stdout, stderr, timedOut };
}

function capped(value: string): string {
  return value.length > 65_536 ? value.slice(-65_536) : value;
}
