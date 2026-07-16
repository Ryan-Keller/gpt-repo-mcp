import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { HermesCancelService } from "../src/services/hermes-cancel-service.js";

describe("HermesCancelService", () => {
  it("validates a derived transaction path in dry-run mode without invoking PowerShell", async () => {
    const root = await mkdtemp(join(tmpdir(), "hermes-cancel-"));
    const transactionId = "offthread-0123456789abcdef";
    const dir = join(root, transactionId);
    await mkdir(dir);
    await writeFile(join(dir, "transaction.json"), JSON.stringify({ transaction_id: transactionId, off_thread_status: "active" }));
    const service = new HermesCancelService(root, "missing.ps1", "missing-pwsh.exe");
    const result = await service.execute({ repo_id: "shared-agent-bridge", transaction_id: transactionId, reason: "Operator dry-run proof", dry_run: true });
    expect(result).toMatchObject({ ok: true, status: "dry_run", before_status: "active", stopped_process_count: 0 });
  });

  it("refuses an already terminal transaction", async () => {
    const root = await mkdtemp(join(tmpdir(), "hermes-cancel-"));
    const transactionId = "offthread-fedcba9876543210";
    const dir = join(root, transactionId);
    await mkdir(dir);
    await writeFile(join(dir, "transaction.json"), JSON.stringify({ transaction_id: transactionId, off_thread_status: "accepted" }));
    const result = await new HermesCancelService(root).execute({ repo_id: "shared-agent-bridge", transaction_id: transactionId, reason: "Should be refused" });
    expect(result.status).toBe("rejected");
    expect(result.warnings[0]).toContain("ALREADY_TERMINAL");
  });
});
