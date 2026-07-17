import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DecisionBundleService, IdeaInboxService } from "../src/services/portfolio-intake-service.js";

describe("portfolio intake services", () => {
  it("deduplicates the existing Idea Inbox by stable identity while preserving lifecycle updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "idea-inbox-")); const service = new IdeaInboxService(root);
    const input = { raw_phrase: "A private phone timeline for every project", normalized_title: "Private project timeline", status: "captured" as const,
      related_projects: ["bridge-field-console"], urgency: "medium" as const, visibility_target: "idea_inbox_only" as const,
      next_prompt: "Which evidence belongs first?", tags: ["phone", "timeline"], source_kind: "chatgpt" as const };
    const first = await service.capture(input); const second = await service.capture({ ...input, status: "ready_for_slice", visibility_target: "portfolio_suggestion" });
    expect(second.idea_id).toBe(first.idea_id); expect((await service.latest())).toMatchObject([{ status: "ready_for_slice" }]);
  });

  it("creates one idempotent server-side decision bundle with dependency waves", async () => {
    const root = await mkdtemp(join(tmpdir(), "decision-bundle-")); const service = new DecisionBundleService(root);
    const command = { idempotency_key: "field-console:a:b", launch_deadline: "2026-07-16T21:00:00.000Z",
      dependencies: [{ action_id: "b", depends_on: ["a"] }], waves: [{ wave: 0, mode: "serial" as const, action_ids: ["a", "b"] }] };
    const first = await service.create(command, ["a", "b"]); const second = await service.create(command, ["a", "b"]);
    expect(second.bundle_id).toBe(first.bundle_id); expect(await service.read()).toHaveLength(1);
    expect(first).toMatchObject({ state: "pending", action_ids: ["a", "b"] });
  });
});
