import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GoalRecordService } from "../src/services/goal-record-service.js";

const command = {
  idempotency_key: "codex:bridge-field-console:release-slice",
  project_id: "bridge-field-console", project_name: "Bridge Field Console", repository_id: "bridge-field-console",
  action_id: "", objective: "Ship and verify the private phone release slice.", source_kind: "codex" as const,
  source_reference: "codex-task-123", plan: ["Implement", "Verify"], dependencies: [], parallel_wave: 0, serial_after: [],
  executor: "codex" as const, routing_reason: "Direct long-running repository implementation supervised by Codex.",
  execution_scope: ["src/**"], privacy_scope: "private_tailnet" as const,
  proof_boundary: "Typecheck, live private route, and Pixel evidence.", satisfaction_threshold: 95
};

describe("GoalRecordService", () => {
  it("registers direct Codex work idempotently and preserves one stable goal", async () => {
    const root = await mkdtemp(join(tmpdir(), "goal-record-"));
    const service = new GoalRecordService(root, () => new Date("2026-07-16T20:00:00.000Z"));
    const first = await service.upsert(command);
    const second = await service.upsert({ ...command, state: "reviewing", satisfaction_score: 91, iteration: 2, unmet_dimensions: ["Pixel proof"] });
    expect(second.goal_id).toBe(first.goal_id);
    expect(second).toMatchObject({ executor: "codex", state: "reviewing", satisfaction_score: 91, iteration: 2 });
    expect(await service.read()).toHaveLength(1);
  });

  it("stores Hermes launch identity for missed-start recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "goal-record-"));
    const service = new GoalRecordService(root);
    const goal = await service.recordLaunch({ ...command, executor: "hermes", source_kind: "field_console" }, {
      ok: true, goal_id: service.goalId(command.idempotency_key), action_id: "a_1", target_repo_id: "bridge-field-console",
      status: "started", transaction_id: "offthread-0123456789abcdef", board: "offthread-field-console", task_id: "t_12345678",
      transaction_path: "private-path", satisfaction_gate: 95, operator_status: "Hermes is working.", observed_at: new Date().toISOString(),
      warnings: [], next_action: "watch"
    });
    expect(goal).toMatchObject({ state: "working", hermes_transaction: "offthread-0123456789abcdef", hermes_board: "offthread-field-console" });
    expect((await service.findIdempotent(command.idempotency_key))?.hermes_transaction).toBe("offthread-0123456789abcdef");
  });

  it("records Field Console review decisions as operator events", async () => {
    const root = await mkdtemp(join(tmpdir(), "goal-record-"));
    const service = new GoalRecordService(root, () => new Date("2026-07-16T20:00:00.000Z"));
    const first = await service.upsert(command);
    const reviewed = await service.recordReviewDecision(command, {
      decision: "no",
      instruction: "This review packet is too vague. Replace it with a smaller field-actionable slice.",
      requested_by: "field_console"
    });

    expect(reviewed.goal_id).toBe(first.goal_id);
    expect(reviewed).toMatchObject({
      state: "reviewing",
      provisional_completion: true,
      retry_count: 1,
      intervention: "This review packet is too vague. Replace it with a smaller field-actionable slice."
    });
    expect(reviewed.events.at(-1)).toMatchObject({
      source: "operator",
      event_type: "field_review_no"
    });
    expect(await service.read()).toHaveLength(1);
  });
});
