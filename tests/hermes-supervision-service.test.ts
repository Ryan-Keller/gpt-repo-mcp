import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { HermesSupervisionService } from "../src/services/hermes-supervision-service.js";

const transactionId = "offthread-0123456789abcdef";

async function fixture(status = "active") {
  const root = await mkdtemp(join(tmpdir(), "hermes-supervision-"));
  const dir = join(root, transactionId);
  await mkdir(join(dir, "process-logs"), { recursive: true });
  await writeFile(join(dir, "transaction.json"), JSON.stringify({
    transaction_id: transactionId,
    board: "supervised-board",
    task_id: "t_123",
    repo_path: "M:\\Example",
    off_thread_status: status,
    worker_status: status === "accepted" ? "completed" : "running",
    kanban_status: status === "accepted" ? "done" : "in_progress",
    operator_status: status === "accepted" ? "Accepted." : "Hermes is working.",
    satisfaction_gate: 95,
    return_armed: false,
    last_observed_at_utc: "2026-07-15T12:00:00Z"
  }), "utf8");
  await writeFile(join(dir, "CHECKPOINTS.md"), [
    "# Checkpoint Queue",
    "",
    "Watcher correction (2026-07-15T12:01Z): verify the foot-contact proof before export."
  ].join("\n"), "utf8");
  await writeFile(join(dir, "process-logs", "Worker.stdout.log"), "phase=inspect\nphase=verify\n", "utf8");
  return { root, dir };
}

describe("HermesSupervisionService", () => {
  test("returns compact transaction evidence and cursor-based live tail", async () => {
    const { root } = await fixture();
    const service = new HermesSupervisionService(root);
    const first = await service.status({ transaction: transactionId, maxEvents: 20 });

    expect(first.state).toBe("available");
    expect(first.transactions[0]).toMatchObject({
      transaction_id: transactionId,
      board: "supervised-board",
      accepted: false,
      operator_status: "Hermes is working."
    });
    expect(first.transactions[0]?.live_tail.some((event) => event.event_type === "watcher_checkpoint")).toBe(true);
    expect(first.transactions[0]?.live_tail.some((event) => event.event_type === "process_stdout_tail")).toBe(true);

    const cursor = first.transactions[0]?.next_cursor ?? "";
    const second = await service.status({ transaction: transactionId, cursor, maxEvents: 20 });
    expect(second.transactions[0]?.live_tail).toEqual([]);
  });

  test("appends a bounded checkpoint and durable intervention receipt", async () => {
    const { root, dir } = await fixture();
    const service = new HermesSupervisionService(root);
    const result = await service.intervene({
      repo_id: "shared-agent-bridge",
      transaction_id: transactionId,
      intervention_type: "verification",
      instruction: "Re-run the contact validator before final acceptance.",
      reason: "The current receipt has no contact evidence.",
      expected_evidence: "Validator command and result in RESULT.md."
    });

    expect(result.status).toBe("checkpoint_appended");
    const checkpoints = await readFile(join(dir, "CHECKPOINTS.md"), "utf8");
    expect(checkpoints).toContain("ChatGPT intervention");
    expect(checkpoints).toContain("Re-run the contact validator");
    const receipts = await readFile(join(dir, "chatgpt-interventions.jsonl"), "utf8");
    expect(receipts).toContain('"intervention_type":"verification"');
  });

  test("rejects writes to terminal transactions", async () => {
    const { root, dir } = await fixture("accepted");
    const service = new HermesSupervisionService(root);
    const result = await service.intervene({
      repo_id: "shared-agent-bridge",
      transaction_id: transactionId,
      intervention_type: "correction",
      instruction: "Do more work."
    });

    expect(result.status).toBe("rejected");
    await expect(readFile(join(dir, "chatgpt-interventions.jsonl"), "utf8")).rejects.toThrow();
  });

  test("acceptance receipt overrides stale operator prose", async () => {
    const { root, dir } = await fixture();
    await writeFile(join(dir, "acceptance-receipt.json"), JSON.stringify({ status: "accepted" }), "utf8");
    const service = new HermesSupervisionService(root);
    const result = await service.status({ transaction: transactionId });

    expect(result.transactions[0]).toMatchObject({
      accepted: true,
      acceptance_status: "accepted",
      operator_status: "Hermes transaction accepted."
    });
  });
});
