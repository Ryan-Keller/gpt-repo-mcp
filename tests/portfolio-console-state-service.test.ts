import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PortfolioConsoleStateService } from "../src/services/portfolio-console-state-service.js";

describe("PortfolioConsoleStateService", () => {
  it("synchronizes seen timestamps and named playbooks durably", async () => {
    const root = await mkdtemp(join(tmpdir(), "portfolio-console-state-"));
    const service = new PortfolioConsoleStateService(root);
    const seenAt = "2026-07-15T20:00:00.000Z";
    await service.update({ project_seen: [{ project_id: "alpha", seen_at: seenAt }] });
    const state = await service.update({ upsert_playbook: { name: "Morning review", action_ids: ["a_alpha"], mode: "verify_then_continue", time_box_minutes: 30, note: "Start with blockers." } });

    expect(state.project_seen).toContainEqual({ project_id: "alpha", seen_at: seenAt });
    expect(state.playbooks[0]).toMatchObject({ name: "Morning review", action_ids: ["a_alpha"] });
    expect(JSON.parse(await readFile(join(root, ".chatgpt", "operations-console-state.json"), "utf8")).version).toBe(1);
  });

  it("registers and removes typed project artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "portfolio-console-state-"));
    const service = new PortfolioConsoleStateService(root);
    const artifact = { artifact_id: "proof-video", project_id: "alpha", title: "Proof video", kind: "video" as const, source: "artifacts/proof.mp4", observed_at: "2026-07-15T21:00:00Z", mime_type: "video/mp4", preview_url: "https://example.com/proof.mp4", open_url: "https://example.com/proof.mp4" };
    const added = await service.update({ upsert_artifact: artifact });
    expect(added.artifacts).toContainEqual(artifact);
    const removed = await service.update({ delete_artifact: artifact.artifact_id });
    expect(removed.artifacts).toEqual([]);
  });

  it("deletes only the selected playbook", async () => {
    const root = await mkdtemp(join(tmpdir(), "portfolio-console-state-"));
    const service = new PortfolioConsoleStateService(root);
    await service.update({ upsert_playbook: { name: "A", action_ids: [], mode: "verify_only", time_box_minutes: 15, note: "" } });
    await service.update({ upsert_playbook: { name: "B", action_ids: [], mode: "continue_safe", time_box_minutes: 60, note: "" } });
    const state = await service.update({ delete_playbook: "A" });
    expect(state.playbooks.map((item) => item.name)).toEqual(["B"]);
  });
});
