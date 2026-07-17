import { createHash, randomUUID } from "node:crypto";
import type { HermesWatchInput, HermesWatchResult } from "../contracts/hermes-supervision.contract.js";
import { HermesKanbanStatusService, type HermesKanbanStatus } from "./hermes-kanban-status-service.js";

const DEFAULT_WATCH_SECONDS = 45;
const DEFAULT_POLL_INTERVAL_SECONDS = 10;
const DEFAULT_MAX_EVENTS = 12;

export class HermesWatchService {
  constructor(private readonly options: {
    statusReader?: (input: { board?: string; transaction?: string; cursor?: string; max_supervision_events?: number; skip_supervision?: boolean }) => Promise<HermesKanbanStatus>;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
  } = {}) {}

  async watch(input: HermesWatchInput): Promise<HermesWatchResult> {
    const watchSeconds = input.watch_seconds ?? DEFAULT_WATCH_SECONDS;
    const pollIntervalSeconds = input.poll_interval_seconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
    const maxEvents = input.max_events ?? DEFAULT_MAX_EVENTS;
    const startedAt = this.now();
    const deadline = startedAt + watchSeconds * 1000;
    const read = this.options.statusReader ?? ((args) => new HermesKanbanStatusService().status(args));
    let pollCount = 0;
    let firstFingerprint = "";
    let latest: HermesKanbanStatus | undefined;
    let stopReason: HermesWatchResult["stop_reason"] = "deadline";

    while (true) {
      pollCount += 1;
      latest = await read({
        board: input.hermes_board,
        transaction: input.hermes_transaction,
        cursor: input.hermes_cursor,
        max_supervision_events: maxEvents,
        skip_supervision: Boolean(input.hermes_board && !input.hermes_transaction)
      });
      const snapshot = summarize(latest, input);
      const fingerprint = stableFingerprint(snapshot);
      if (!firstFingerprint) firstFingerprint = fingerprint;

      if (snapshot.terminal) {
        stopReason = "terminal";
        break;
      }
      if (snapshot.state === "blocked") {
        stopReason = "blocked";
        break;
      }
      if (snapshot.state === "unavailable") {
        stopReason = "unavailable";
        break;
      }
      if (snapshot.events.length > 0) {
        stopReason = "new_event";
        break;
      }
      if (pollCount > 1 && fingerprint !== firstFingerprint) {
        stopReason = "changed";
        break;
      }

      const remaining = deadline - this.now();
      if (remaining <= 0) break;
      await this.sleep(Math.min(remaining, pollIntervalSeconds * 1000));
    }

    const summary = summarize(latest!, input);
    const changed = stopReason === "changed" || stopReason === "new_event" || stopReason === "terminal";
    const terminal = summary.terminal;
    return {
      ok: !["blocked", "unavailable"].includes(stopReason),
      repo_id: input.repo_id,
      watch_id: `hermes-watch-${randomUUID()}`,
      observed_at: new Date(this.now()).toISOString(),
      target_type: input.hermes_board && input.hermes_transaction ? "board_and_transaction" : input.hermes_transaction ? "transaction" : "board",
      hermes_board: input.hermes_board ?? summary.board,
      hermes_transaction: input.hermes_transaction ?? summary.transactionId,
      state: summary.state,
      operator_status: summary.operatorStatus,
      changed,
      heartbeat: !changed && stopReason === "deadline",
      terminal,
      continue_required: !terminal && !["blocked", "unavailable"].includes(stopReason),
      final_response_allowed: terminal,
      stop_reason: stopReason,
      poll_count: pollCount,
      elapsed_ms: Math.max(0, this.now() - startedAt),
      next_cursor: summary.nextCursor || input.hermes_cursor || "",
      acceptance_status: summary.acceptanceStatus,
      satisfaction_gate: summary.satisfactionGate ?? -1,
      board_counts: Object.entries(summary.boardCounts)
        .map(([status, count]) => ({ status, count }))
        .sort((left, right) => left.status.localeCompare(right.status)),
      tasks: summary.tasks,
      events: summary.events,
      request: {
        repo_id: input.repo_id,
        hermes_board: input.hermes_board ?? "",
        hermes_transaction: input.hermes_transaction ?? "",
        watch_seconds: watchSeconds,
        poll_interval_seconds: pollIntervalSeconds,
        max_events: maxEvents
      },
      warnings: latest!.warnings.concat(latest!.supervision.warnings),
      next_action: terminal
        ? "report_terminal_hermes_evidence"
        : stopReason === "blocked" || stopReason === "unavailable"
          ? latest!.suggested_next_action
          : "refresh_repo_runner_status_with_capability_id_hermes_kanban_and_the_next_cursor"
    };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private sleep(milliseconds: number): Promise<void> {
    return (this.options.sleep ?? ((duration) => new Promise((resolve) => setTimeout(resolve, duration))))(milliseconds);
  }
}

function summarize(status: HermesKanbanStatus, input: HermesWatchInput) {
  const transaction = status.supervision.transactions[0];
  const board = status.boards.find((candidate) => candidate.board === input.hermes_board) ?? status.boards[0];
  const accepted = transaction?.accepted === true;
  const transactionStatus = transaction?.off_thread_status ?? "";
  const transactionRequired = Boolean(input.hermes_transaction);
  const blocked = status.state === "blocked" || (transactionRequired && status.supervision.state === "blocked");
  const unavailable = status.state === "unavailable" && (!transactionRequired || status.supervision.state === "unavailable");
  const terminal = accepted || ["accepted", "cancelled", "stopped"].includes(transactionStatus);
  const openCount = Object.entries(board?.by_status ?? {}).some(([key, count]) => key !== "done" && count > 0);
  const state: HermesWatchResult["state"] = blocked ? "blocked"
    : unavailable ? "unavailable"
      : terminal ? (accepted ? "accepted" : "stopped")
        : transaction?.kanban_status === "proof_check" ? "proof_check"
          : transaction || openCount ? "working" : "waiting";
  return {
    state,
    terminal,
    board: transaction?.board ?? board?.board ?? "",
    transactionId: transaction?.transaction_id ?? "",
    operatorStatus: transaction?.operator_status ?? (openCount ? "Hermes board has open work." : "Hermes watch heartbeat; no new evidence."),
    acceptanceStatus: transaction?.acceptance_status ?? "not_available",
    satisfactionGate: transaction?.satisfaction_gate ?? null,
    nextCursor: transaction?.next_cursor ?? input.hermes_cursor ?? "",
    boardCounts: board?.by_status ?? {},
    tasks: (board?.tasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      assignee: task.assignee,
      status: task.status,
      priority: task.priority ?? -1,
      created_at: task.created_at ?? -1,
      started_at: task.started_at ?? -1,
      completed_at: task.completed_at ?? -1,
      result_present: task.result_present,
      result_summary: task.result_summary
    })),
    events: transaction?.live_tail ?? []
  };
}

function stableFingerprint(value: ReturnType<typeof summarize>): string {
  return createHash("sha256").update(JSON.stringify({
    state: value.state,
    terminal: value.terminal,
    acceptanceStatus: value.acceptanceStatus,
    boardCounts: value.boardCounts,
    tasks: value.tasks,
    nextCursor: value.nextCursor
  })).digest("hex");
}
