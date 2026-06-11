import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { BridgeConciergeService } from "../src/services/bridge-concierge-service.js";

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bridge-concierge-"));
  await mkdir(join(root, "shared", "state"), { recursive: true });
  await mkdir(join(root, "shared", "status"), { recursive: true });
  await writeFile(join(root, "shared", "state", "project_memory_v1.json"), JSON.stringify({
    schema_version: 1,
    projects: [
      {
        key: "bridge",
        label: "Bridge",
        status: "active",
        phase: "bridge reliability plus Feeder v0",
        product_track: "Execution layer for queueing, runner status, MCP tools, locks, results, and recovery evidence.",
        confidence: "high",
        summary: "Bridge coordinates ChatGPT, Codex, repo-backed task packets, runner state, and recovery evidence.",
        evidence: ["docs/WORKSPACE_MAP.md"],
        roadmap: [{ item: "Keep runner observable.", state: "active", next_step: "Use runner status before packaging work." }],
        risks: [{ risk: "Source edits can be mistaken for live tool changes.", mitigation: "Run live guard before claiming exposure." }],
        recent_results: [{ date: "2026-06-10", summary: "Bridge orientation landed.", source: "shared/status/2026-06-10-bridge-orientation-v0.md" }],
        next_moves: ["Use current runner status before packaging follow-up Codex work."]
      }
    ]
  }), "utf8");
  await writeFile(join(root, "shared", "status", "2026-06-11-visual-stream-renderer-witness-hybrid-v0.md"), [
    "# Visual Stream Renderer Witness Hybrid V0",
    "",
    "status: completed",
    "date: 2026-06-11",
    "",
    "## Summary",
    "",
    "Connected deterministic video frame delta events to a renderer-facing witness preview helper without camera use or Bridge mutation.",
    "",
    "## Evidence",
    "",
    "- Added visual_stream_renderer_witness_hybrid_v0.py.",
    "- Updated voice-renderer.html with proposal-only patch previews.",
    "",
    "## Future Work",
    "",
    "- Real camera capture remains out of scope.",
    "- Automatic patch execution remains out of scope."
  ].join("\n"), "utf8");
  await writeFile(join(root, "shared", "status", "2026-06-11-bridge-concierge-tool.md"), [
    "# Bridge Concierge Tool",
    "",
    "status: completed",
    "date: 2026-06-11",
    "",
    "## Summary",
    "",
    "Added a concierge tool with examples like check visual streaming and What happened overnight.",
    "",
    "## Boundary",
    "",
    "- Does not replace project or capability destination status."
  ].join("\n"), "utf8");
  return root;
}

describe("BridgeConciergeService", () => {
  test("resolves visual streaming from intention to destination packet", async () => {
    const root = await fixtureRoot();
    const result = await new BridgeConciergeService({
      repo_id: "fixture",
      display_name: "Fixture",
      root
    }).answer({ request: "check visual streaming" });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("destination_status");
    expect(result.destination.label).toBe("Visual Streaming Project");
    expect(result.destination.kind).toBe("project");
    expect(result.current_status).toContain("completed");
    expect(result.latest_progress[0]).toContain("Visual Stream Renderer Witness Hybrid V0");
    expect(result.open_issues).toEqual(expect.arrayContaining([
      expect.stringContaining("Real camera capture remains out of scope")
    ]));
    expect(result.recommended_next_action).toContain("Real camera capture remains out of scope");
    expect(result.known).toEqual(expect.arrayContaining([
      expect.stringContaining("Connected deterministic video frame delta events")
    ]));
    expect(result.unknown).toEqual(expect.arrayContaining([
      expect.stringContaining("No persistent project-memory entry exactly matched")
    ]));
    expect(result.evidence[0]).toMatchObject({
      path: "shared/status/2026-06-11-visual-stream-renderer-witness-hybrid-v0.md"
    });
    expect(result.next_tool_hints[0].tool).toBe("repo_runner_status");
    expect(result.plain_text).toContain("Current status:");
  });

  test("answers overnight as workspace digest without storage-first routing", async () => {
    const root = await fixtureRoot();
    const result = await new BridgeConciergeService({
      repo_id: "fixture",
      display_name: "Fixture",
      root
    }).answer({ request: "What happened overnight?" });

    expect(result.mode).toBe("workspace_digest");
    expect(result.destination.kind).toBe("workspace");
    expect(result.current_status).toContain("recent status notes");
    expect(result.latest_progress.length).toBeGreaterThan(0);
    expect(result.unknown).toEqual(expect.arrayContaining([
      expect.stringContaining("Overnight means recent local status evidence")
    ]));
  });
});
