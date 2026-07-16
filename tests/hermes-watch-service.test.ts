import { describe, expect, test } from "vitest";
import type { HermesKanbanStatus } from "../src/services/hermes-kanban-status-service.js";
import { HermesWatchService } from "../src/services/hermes-watch-service.js";

describe("HermesWatchService", () => {
  test("holds through unchanged observations and returns a factual deadline heartbeat", async () => {
    let now = Date.parse("2026-07-15T14:00:00.000Z");
    const service = new HermesWatchService({
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
      statusReader: async () => fixtureStatus()
    });
    const result = await service.watch({
      repo_id: "shared-agent-bridge",
      hermes_board: "offthread-svg-sample-book",
      watch_seconds: 20,
      poll_interval_seconds: 10
    });
    expect(result).toMatchObject({
      heartbeat: true,
      changed: false,
      terminal: false,
      stop_reason: "deadline",
      poll_count: 3,
      elapsed_ms: 20_000,
      continue_required: true,
      final_response_allowed: false
    });
  });

  test("does not block a readable board because unrelated transaction artifacts are blocked", async () => {
    let now = 0;
    const status = fixtureStatus();
    status.supervision.state = "blocked";
    status.supervision.transactions = [];
    const result = await new HermesWatchService({
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
      statusReader: async () => status
    }).watch({
      repo_id: "shared-agent-bridge",
      hermes_board: "offthread-svg-sample-book",
      watch_seconds: 10,
      poll_interval_seconds: 5
    });
    expect(result).toMatchObject({
      ok: true,
      state: "working",
      heartbeat: true,
      stop_reason: "deadline",
      poll_count: 3,
      satisfaction_gate: -1,
      board_counts: [{ status: "done", count: 1 }, { status: "scheduled", count: 1 }]
    });
  });

  test("returns immediately when a new transaction event appears", async () => {
    let calls = 0;
    const service = new HermesWatchService({
      statusReader: async () => fixtureStatus(calls++ === 0 ? [] : [{
        cursor: "2026-07-15T14:00:10.000Z|result",
        observed_at: "2026-07-15T14:00:10.000Z",
        event_type: "result",
        source: "RESULT.md",
        summary: "Fresh proof arrived."
      }]),
      sleep: async () => undefined
    });
    const result = await service.watch({
      repo_id: "shared-agent-bridge",
      hermes_transaction: "offthread-0123456789abcdef",
      hermes_cursor: "2026-07-15T14:00:00.000Z|start",
      watch_seconds: 10,
      poll_interval_seconds: 5
    });
    expect(result.stop_reason).toBe("new_event");
    expect(result.changed).toBe(true);
    expect(result.events[0]?.summary).toBe("Fresh proof arrived.");
  });

  test("allows a final response only after accepted transaction evidence", async () => {
    const status = fixtureStatus();
    status.supervision.transactions[0]!.accepted = true;
    status.supervision.transactions[0]!.acceptance_status = "accepted";
    status.supervision.transactions[0]!.off_thread_status = "accepted";
    const result = await new HermesWatchService({ statusReader: async () => status }).watch({
      repo_id: "shared-agent-bridge",
      hermes_transaction: "offthread-0123456789abcdef"
    });
    expect(result).toMatchObject({
      state: "accepted",
      terminal: true,
      stop_reason: "terminal",
      continue_required: false,
      final_response_allowed: true
    });
  });
});

function fixtureStatus(events: HermesKanbanStatus["supervision"]["transactions"][number]["live_tail"] = []): HermesKanbanStatus {
  return {
    state: "available",
    current_route: "repo_runner_status.capability_summary.hermes_kanban",
    requested_board: "offthread-svg-sample-book",
    wsl_distro: "HermesUbuntu",
    boards_root: "/home/ryan/.hermes/kanban/boards",
    board_count: 1,
    boards: [{
      board: "offthread-svg-sample-book",
      board_path: "/board",
      by_status: { scheduled: 1, done: 1 },
      by_assignee: {}, oldest_ready_age_seconds: 1, task_count: 2,
      tasks: [{ id: "t_1", title: "Volume II", assignee: "hermes", status: "scheduled", priority: 1, created_at: 1, started_at: null, completed_at: null, workspace_path: "", result_present: false, result_summary: "" }],
      artifacts_advertised: [], artifact_caveat: ""
    }],
    supervision: {
      state: "available", requested_transaction: "offthread-0123456789abcdef", transaction_root: "D:/Hermes", transaction_count: 1,
      transactions: [{
        transaction_id: "offthread-0123456789abcdef", operator_status: "Hermes is working.", board: "offthread-svg-sample-book", task_id: "t_1", repo_path: "", off_thread_status: "working", worker_status: "running", kanban_status: "in_progress", acceptance_status: "not_available", accepted: false, satisfaction_gate: 9, return_armed: true, last_observed_at: "", required_receipts: [], checkpoint_path: "", intervention_receipt_path: "", live_tail: events, next_cursor: events.at(-1)?.cursor ?? "2026-07-15T14:00:00.000Z|start", next_action: "continue_watching_for_new_evidence"
      }],
      evidence: [], warnings: [], safe_operations: [], blocked_operations: [], suggested_next_action: "continue"
    },
    evidence: [], warnings: [], safe_operations: [], blocked_operations: [], suggested_next_action: "continue"
  };
}
