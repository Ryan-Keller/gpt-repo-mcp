import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PortfolioActionActivity, PortfolioActionCommandInput, PortfolioActionCommandResult, PortfolioActionLedgerEntry, PortfolioActionState } from "../contracts/portfolio-action.contract.js";

export type PortfolioActionLedgerSnapshot = { entries: PortfolioActionLedgerEntry[]; activity: PortfolioActionActivity[] };
type StoredLedger = PortfolioActionLedgerSnapshot & { version: 1; updated_at: string };

export class PortfolioActionLedgerService {
  private static readonly queues = new Map<string, Promise<void>>();
  private readonly path: string;
  constructor(private readonly repoRoot: string) {
    this.path = join(repoRoot, ".chatgpt", "portfolio-action-ledger.json");
  }

  async read(): Promise<PortfolioActionLedgerSnapshot> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<StoredLedger>;
      return {
        entries: Array.isArray(parsed.entries) ? parsed.entries.map((entry) => ({ ...entry, snooze_until: entry.snooze_until ?? "" })) : [],
        activity: Array.isArray(parsed.activity) ? parsed.activity : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], activity: [] };
      throw error;
    }
  }

  async execute(repoId: string, input: PortfolioActionCommandInput): Promise<PortfolioActionCommandResult> {
    const previous = PortfolioActionLedgerService.queues.get(this.path) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    PortfolioActionLedgerService.queues.set(this.path, queued);
    await previous;
    try {
      return await this.executeUnlocked(repoId, input);
    } finally {
      release();
      if (PortfolioActionLedgerService.queues.get(this.path) === queued) PortfolioActionLedgerService.queues.delete(this.path);
    }
  }

  private async executeUnlocked(repoId: string, input: PortfolioActionCommandInput): Promise<PortfolioActionCommandResult> {
    const snapshot = await this.read();
    const byId = new Map(snapshot.entries.map((entry) => [entry.action_id, entry]));
    const now = new Date().toISOString();
    const warnings: string[] = [];
    const changed: PortfolioActionLedgerEntry[] = [];
    let unchanged = 0;
    if (input.operation === "snooze" && (!input.snooze_until || Date.parse(input.snooze_until) <= Date.now())) {
      return {
        ok: false, repo_id: repoId, operation: input.operation, changed_count: 0, unchanged_count: input.actions.length,
        entries: [], recent_activity: snapshot.activity.slice(0, 30), observed_at: now,
        ledger_path: ".chatgpt/portfolio-action-ledger.json", storage_path: ".chatgpt/portfolio-action-ledger.json", warnings: ["SNOOZE_UNTIL_MUST_BE_FUTURE"],
        next_action: "choose_a_future_snooze_time_and_retry"
      };
    }
    for (const item of input.actions) {
      const previous = byId.get(item.action_id);
      if (item.expected_state && previous?.state !== item.expected_state) {
        warnings.push(`STATE_MISMATCH:${item.action_id}:${previous?.state ?? "unseen"}`);
        unchanged++;
        continue;
      }
      if (input.operation !== "route" && input.operation !== "restore" && input.operation !== "archive" && !previous) {
        warnings.push(`ACTION_NOT_FOUND:${item.action_id}`);
        unchanged++;
        continue;
      }
      const nextState = targetState(input.operation, previous?.state);
      if (!nextState) {
        warnings.push(`INVALID_TRANSITION:${item.action_id}:${previous?.state ?? "unseen"}:${input.operation}`);
        unchanged++;
        continue;
      }
      if (previous?.state === nextState) {
        unchanged++;
        continue;
      }
      const entry: PortfolioActionLedgerEntry = {
        action_id: item.action_id,
        project_id: item.project_id ?? previous?.project_id ?? "unknown",
        project_name: item.project_name ?? previous?.project_name ?? item.project_id ?? "Unknown project",
        title: item.title ?? previous?.title ?? item.action_id,
        route: item.route ?? previous?.route ?? "unknown",
        risk: item.risk ?? previous?.risk ?? "approval_required",
        state: nextState,
        report_id: input.report_id ?? previous?.report_id ?? "",
        attempt_count: (previous?.attempt_count ?? 0) + (input.operation === "route" ? 1 : 0),
        updated_at: now,
        reason: input.reason ?? "",
        receipt_summary: input.receipt_summary ?? "",
        snooze_until: input.operation === "snooze" ? input.snooze_until ?? "" : previous?.snooze_until ?? ""
      };
      byId.set(item.action_id, entry);
      changed.push(entry);
      snapshot.activity.unshift({
        event_id: randomUUID(), action_id: entry.action_id, project_id: entry.project_id, title: entry.title,
        operation: input.operation, from_state: previous?.state ?? "unseen", to_state: entry.state,
        observed_at: now, reason: entry.reason, receipt_summary: entry.receipt_summary
      });
    }
    const stored: StoredLedger = { version: 1, updated_at: now, entries: [...byId.values()], activity: snapshot.activity.slice(0, 250) };
    if (changed.length) await this.write(stored);
    return {
      ok: warnings.length === 0, repo_id: repoId, operation: input.operation,
      changed_count: changed.length, unchanged_count: unchanged, entries: changed,
      recent_activity: stored.activity.slice(0, 30), observed_at: now,
      ledger_path: ".chatgpt/portfolio-action-ledger.json", storage_path: ".chatgpt/portfolio-action-ledger.json", warnings,
      next_action: "refresh_repo_portfolio_report_to_verify_the_updated_action_console"
    };
  }

  private async write(value: StoredLedger): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, this.path);
  }
}

function targetState(operation: PortfolioActionCommandInput["operation"], previous?: PortfolioActionState): PortfolioActionState | undefined {
  if (operation === "restore") return previous === "archived" || previous === "stopped" || previous === "completed" || previous === "snoozed" ? "available" : undefined;
  if (operation === "route") return previous === undefined || previous === "available" || previous === "snoozed" ? "routed" : undefined;
  if (operation === "working") return previous === "routed" ? "working" : undefined;
  if (operation === "complete") return previous === "routed" || previous === "working" ? "completed" : undefined;
  if (operation === "stop") return previous === "routed" || previous === "working" ? "stopped" : undefined;
  if (operation === "snooze") return previous === "routed" || previous === "working" ? "snoozed" : undefined;
  if (operation === "archive") return previous !== "archived" ? "archived" : undefined;
  return undefined;
}
