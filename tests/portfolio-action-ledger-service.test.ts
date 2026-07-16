import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { PortfolioActionLedgerService } from "../src/services/portfolio-action-ledger-service.js";

describe("PortfolioActionLedgerService", () => {
  it("records lifecycle receipts and prevents duplicate transitions", async () => {
    const root = await mkdtemp(join(tmpdir(), "portfolio-ledger-"));
    const service = new PortfolioActionLedgerService(root);
    const action = { action_id: "a_1234567890", project_id: "bridge", project_name: "Bridge", title: "Verify widget", route: "verify_project", risk: "read_only" as const };

    const routed = await service.execute("shared-agent-bridge", { repo_id: "shared-agent-bridge", operation: "route", report_id: "r1", actions: [action] });
    expect(routed.changed_count).toBe(1);
    expect(routed.entries[0]?.state).toBe("routed");

    const duplicate = await service.execute("shared-agent-bridge", { repo_id: "shared-agent-bridge", operation: "route", report_id: "r1", actions: [action] });
    expect(duplicate.changed_count).toBe(0);
    expect(duplicate.unchanged_count).toBe(1);

    const complete = await service.execute("shared-agent-bridge", { repo_id: "shared-agent-bridge", operation: "complete", actions: [{ action_id: action.action_id, expected_state: "routed" }], receipt_summary: "Verified in fixture." });
    expect(complete.entries[0]?.state).toBe("completed");
    expect(complete.recent_activity[0]?.receipt_summary).toBe("Verified in fixture.");
    expect(JSON.parse(await readFile(join(root, ".chatgpt", "portfolio-action-ledger.json"), "utf8")).version).toBe(1);
  });

  it("restores a terminal action to the selectable pool", async () => {
    const root = await mkdtemp(join(tmpdir(), "portfolio-ledger-"));
    const service = new PortfolioActionLedgerService(root);
    await service.execute("shared-agent-bridge", { repo_id: "shared-agent-bridge", operation: "route", actions: [{ action_id: "a_restore", title: "Restore me" }] });
    await service.execute("shared-agent-bridge", { repo_id: "shared-agent-bridge", operation: "archive", actions: [{ action_id: "a_restore" }] });
    const restored = await service.execute("shared-agent-bridge", { repo_id: "shared-agent-bridge", operation: "restore", actions: [{ action_id: "a_restore" }] });
    expect(restored.entries[0]?.state).toBe("available");
  });

  it("archives an unseen suggestion so rejection never routes it", async () => {
    const root = await mkdtemp(join(tmpdir(), "portfolio-ledger-"));
    const service = new PortfolioActionLedgerService(root);
    const archived = await service.execute("shared-agent-bridge", {
      repo_id: "shared-agent-bridge",
      operation: "archive",
      report_id: "r-reject",
      actions: [{ action_id: "a_rejected", project_id: "alpha", title: "Reject me" }],
      reason: "Return a different suggestion."
    });
    expect(archived).toMatchObject({ ok: true, changed_count: 1 });
    expect(archived.entries[0]).toMatchObject({ state: "archived", attempt_count: 0 });
    expect(archived.recent_activity[0]).toMatchObject({ operation: "archive", from_state: "unseen", to_state: "archived" });
  });

  it("requires a future snooze and records its wake time", async () => {
    const root = await mkdtemp(join(tmpdir(), "portfolio-ledger-"));
    const service = new PortfolioActionLedgerService(root);
    await service.execute("shared-agent-bridge", { repo_id: "shared-agent-bridge", operation: "route", actions: [{ action_id: "a_snooze", title: "Snooze me" }] });
    const rejected = await service.execute("shared-agent-bridge", { repo_id: "shared-agent-bridge", operation: "snooze", actions: [{ action_id: "a_snooze" }], snooze_until: "2020-01-01T00:00:00.000Z" });
    expect(rejected.warnings).toContain("SNOOZE_UNTIL_MUST_BE_FUTURE");
    const wake = new Date(Date.now() + 86_400_000).toISOString();
    const snoozed = await service.execute("shared-agent-bridge", { repo_id: "shared-agent-bridge", operation: "snooze", actions: [{ action_id: "a_snooze", expected_state: "routed" }], snooze_until: wake });
    expect(snoozed.entries[0]).toMatchObject({ state: "snoozed", snooze_until: wake });
  });
});
