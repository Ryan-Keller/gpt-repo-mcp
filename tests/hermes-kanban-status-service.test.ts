import { describe, expect, test } from "vitest";
import { HermesKanbanStatusService } from "../src/services/hermes-kanban-status-service.js";

describe("HermesKanbanStatusService", () => {
  test("reads a focused board through bounded Hermes CLI calls", async () => {
    const calls: string[][] = [];
    const service = new HermesKanbanStatusService({
      wslDistro: "HermesUbuntu",
      boardsRoot: "/home/ryan/.hermes/kanban/boards",
      commandRunner: async (_command, args) => {
        calls.push(args);
        const text = args.join(" ");
        if (text.includes(" stats --json")) {
          return JSON.stringify({
            by_status: { done: 4 },
            by_assignee: { orchestrator: { done: 1 }, skillsmith: { done: 2 } },
            oldest_ready_age_seconds: null
          });
        }
        if (text.includes(" list --json")) {
          return JSON.stringify([
            {
              id: "t_8203890c",
              title: "Orchestrator preflight",
              assignee: "orchestrator",
              status: "done",
              priority: 0,
              created_at: 1782700542,
              started_at: 1782700572,
              completed_at: 1782701237,
              workspace_path: "/home/ryan/.hermes/kanban/boards/example/workspaces/t_8203890c",
              result: "Completed preflight and created downstream tasks."
            }
          ]);
        }
        throw new Error(`unexpected command: ${text}`);
      }
    });

    const result = await service.status({
      board: "hermes-intake-chatgpt-swarm-commit-push-m-repos-2026-06-29"
    });

    expect(result).toMatchObject({
      state: "available",
      requested_board: "hermes-intake-chatgpt-swarm-commit-push-m-repos-2026-06-29",
      board_count: 1,
      boards: [{
        board: "hermes-intake-chatgpt-swarm-commit-push-m-repos-2026-06-29",
        by_status: { done: 4 },
        task_count: 1,
        tasks: [{
          id: "t_8203890c",
          status: "done",
          result_present: true
        }]
      }]
    });
    expect(calls).toHaveLength(2);
    expect(result.blocked_operations).toContain("stage_commit_push");
  });

  test("rejects unsafe board slugs without spawning Hermes", async () => {
    const service = new HermesKanbanStatusService({
      commandRunner: async () => {
        throw new Error("should not run");
      }
    });

    const result = await service.status({ board: "../bad" });

    expect(result).toMatchObject({
      state: "blocked",
      requested_board: "../bad",
      warnings: ["HERMES_KANBAN_INVALID_BOARD_SLUG"],
      suggested_next_action: "retry_with_lowercase_dash_board_slug"
    });
  });
});
