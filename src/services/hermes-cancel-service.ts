import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { HermesCancelInput, HermesCancelResult } from "../contracts/hermes-supervision.contract.js";

const execFileAsync = promisify(execFile);
const ROOT = "D:\\HermesDesktop\\workspace\\handoff\\off-thread";
const SCRIPT = "D:\\HermesDesktop\\scripts\\hermes-off-thread.ps1";
const PWSH = "C:\\Users\\Ryan\\AppData\\Local\\Programs\\PowerShell\\7\\pwsh.exe";

export class HermesCancelService {
  constructor(private readonly root = ROOT, private readonly script = SCRIPT, private readonly pwsh = PWSH) {}
  async execute(input: HermesCancelInput): Promise<HermesCancelResult> {
    const transactionPath = join(this.root, input.transaction_id, "transaction.json");
    const transaction = JSON.parse(await readFile(transactionPath, "utf8")) as Record<string, unknown>;
    if (transaction.transaction_id !== input.transaction_id) throw new Error("Hermes transaction identity mismatch.");
    const before = String(transaction.off_thread_status ?? transaction.worker_status ?? "unknown");
    if (["accepted", "cancelled", "stopped"].includes(before.toLowerCase())) {
      return this.result(input, "rejected", before, before, 0, "", [`TRANSACTION_ALREADY_TERMINAL:${before}`]);
    }
    if (input.dry_run) return this.result(input, "dry_run", before, before, 0, "", []);
    const { stdout } = await execFileAsync(this.pwsh, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", this.script, "-Command", "Cancel", "-TransactionPath", transactionPath, "-Reason", input.reason], { windowsHide: true, timeout: 120_000, maxBuffer: 2_000_000 });
    const parsed = JSON.parse(stdout) as { receipt_path?: string; stopped_processes?: unknown[]; transaction?: Record<string, unknown> };
    return this.result(input, "cancelled", before, String(parsed.transaction?.off_thread_status ?? "cancelled"), parsed.stopped_processes?.length ?? 0, parsed.receipt_path ?? "", []);
  }

  private result(input: HermesCancelInput, status: HermesCancelResult["status"], before: string, after: string, count: number, receipt: string, warnings: string[]): HermesCancelResult {
    return { ok: warnings.length === 0, status, repo_id: input.repo_id, transaction_id: input.transaction_id, before_status: before, after_status: after, stopped_process_count: count, receipt_path: receipt, observed_at: new Date().toISOString(), warnings, next_action: "refresh_repo_runner_status_with_capability_id_hermes_kanban_then_archive_any_irrelevant_kanban_task" };
  }
}
