import { describe, expect, test } from "vitest";
import { HermesKanbanCommandService } from "../src/services/hermes-kanban-command-service.js";

describe("HermesKanbanCommandService", () => {
  test("uses optimistic task status and passes user text as a literal argv value without a shell", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    let showCount = 0;
    const service = new HermesKanbanCommandService({
      commandRunner: async (command, args) => {
        calls.push({ command, args });
        if (args.includes("show")) {
          showCount += 1;
          return JSON.stringify({ task: { id: "t_1234abcd", title: "Repair proof", assignee: "uxui", status: showCount === 1 ? "blocked" : "ready" } });
        }
        return "";
      }
    });
    const instruction = "Approved recovery; $(touch /tmp/should-not-run)";
    const result = await service.execute({
      repo_id: "shared-agent-bridge",
      board: "proof-board",
      operation: "unblock",
      task_id: "t_1234abcd",
      expected_status: "blocked",
      instruction
    });

    expect(result).toMatchObject({ ok: true, status: "executed", before_status: "blocked", after_status: "ready" });
    expect(calls).toHaveLength(3);
    expect(calls[1]?.args).not.toContain("bash");
    expect(calls[1]?.args).not.toContain("-lc");
    expect(calls[1]?.args).toContain(instruction);
    expect(calls[1]?.command).toBe("wsl.exe");
  });

  test("rejects stale expected status before mutation", async () => {
    const calls: string[][] = [];
    const service = new HermesKanbanCommandService({
      commandRunner: async (_command, args) => {
        calls.push(args);
        return JSON.stringify({ task: { id: "t_1234abcd", title: "Repair proof", assignee: "uxui", status: "running" } });
      }
    });
    const result = await service.execute({
      repo_id: "shared-agent-bridge",
      board: "proof-board",
      operation: "block",
      task_id: "t_1234abcd",
      expected_status: "ready",
      instruction: "Fresh error evidence requires review.",
      block_kind: "transient"
    });

    expect(result).toMatchObject({ ok: false, status: "rejected", warnings: ["HERMES_EXPECTED_STATUS_MISMATCH:running"] });
    expect(calls).toHaveLength(1);
  });

  test("returns a mutation-free dry-run plan for a deduplicated follow-up", async () => {
    let callCount = 0;
    const service = new HermesKanbanCommandService({ commandRunner: async () => { callCount += 1; return ""; } });
    const result = await service.execute({
      repo_id: "shared-agent-bridge",
      board: "proof-board",
      operation: "create_followup",
      title: "Verify repaired proof",
      body: "Inspect the new receipt and attach evidence.",
      assignee: "uxui",
      idempotency_key: "chatgpt:proof-board:verify-repaired-proof",
      dry_run: true
    });

    expect(result).toMatchObject({ ok: true, status: "dry_run", before_status: "not_created" });
    expect(callCount).toBe(0);
  });

  test("blocks reassigning a running task because reclaim is outside the guarded seam", async () => {
    const service = new HermesKanbanCommandService({
      commandRunner: async () => JSON.stringify({ task: { id: "t_1234abcd", title: "Running", assignee: "uxui", status: "running" } })
    });
    const result = await service.execute({
      repo_id: "shared-agent-bridge",
      board: "proof-board",
      operation: "assign",
      task_id: "t_1234abcd",
      expected_status: "running",
      assignee: "reviewer"
    });
    expect(result.warnings).toEqual(["HERMES_RUNNING_TASK_REASSIGN_REQUIRES_RECLAIM"]);
  });

  test("archives only after recording a reason and preserves the no-shell argv boundary", async () => {
    const calls: string[][] = [];
    let shows = 0;
    const service = new HermesKanbanCommandService({ commandRunner: async (_command, args) => {
      calls.push(args);
      if (args.includes("show")) return JSON.stringify({ task: { id: "t_1234abcd", title: "Obsolete", assignee: "uxui", status: shows++ ? "archived" : "scheduled" } });
      return "";
    } });
    const result = await service.execute({ repo_id: "shared-agent-bridge", board: "proof-board", operation: "archive", task_id: "t_1234abcd", expected_status: "scheduled", instruction: "Superseded by accepted project work." });
    expect(result).toMatchObject({ ok: true, before_status: "scheduled", after_status: "archived" });
    expect(calls[1]).toContain("comment");
    expect(calls[2]).toContain("archive");
    expect(calls.flat()).not.toContain("bash");
  });
});
