import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ProjectMemoryService } from "../src/services/project-memory-service.js";
import { PathSandbox } from "../src/services/path-sandbox.js";
import { createRepoFixture } from "./fixtures/repo-fixture.js";

describe("ProjectMemoryService", () => {
  test("summarizes file-based project memory into a ChatGPT dashboard", async () => {
    const fixture = await createRepoFixture();
    await mkdir(join(fixture.root, ".chatgpt", "project-memory"), { recursive: true });
    await writeFile(join(fixture.root, ".chatgpt", "project-memory", "projects.json"), JSON.stringify({
      schema_version: 1,
      generated_at: "2026-06-08T03:20:00Z",
      projects: [
        {
          id: "shared-agent-bridge",
          name: "Shared Agent Bridge",
          status: "active",
          phase: "bridge reliability",
          product_track: "persistent project memory v1",
          confidence: "high",
          summary: "Repo-backed coordination between ChatGPT and Codex.",
          roadmap: [
            {
              milestone: "Project memory v1",
              state: "active",
              next_step: "Expose a read-only dashboard."
            }
          ],
          paused_ideas: [
            {
              title: "Dream report scheduler",
              reason_paused: "Needs durable trigger policy.",
              next_tiny_experiment: "Generate one manual report from local templates."
            }
          ],
          decisions: [
            {
              title: "Stay file-based for v1",
              decision: "Use .chatgpt/project-memory JSON and Markdown before adding a database.",
              confidence: "high"
            }
          ],
          research_watchlist: [
            {
              topic: "Local research routes",
              cadence: "weekly",
              status: "watching"
            }
          ],
          risks: [
            {
              risk: "Memory drift",
              mitigation: "Mark uncertain fields as draft or unknown."
            }
          ],
          recent_results: [
            {
              date: "2026-06-08",
              summary: "Concurrency canary completed.",
              source: ".chatgpt/codex-runs/2026-06-08T031000Z-concurrency-canary-a/RESULT.md"
            }
          ],
          artifacts: [{
            id: "proof-image",
            title: "Proof image",
            kind: "image",
            source: "artifacts/proof.png",
            observed_at: "2026-06-08T03:10:00Z",
            mime_type: "image/png",
            preview_url: "https://example.com/proof.png",
            open_url: "https://example.com/proof.png"
          }],
          suggested_next_moves: [
            "Write a dashboard reader."
          ]
        }
      ]
    }, null, 2));

    const result = await new ProjectMemoryService({
      repo_id: "fixture",
      display_name: "Fixture",
      root: fixture.root
    }, new PathSandbox(fixture.root)).dashboard();

    expect(result.ok).toBe(true);
    expect(result.project_count).toBe(1);
    expect(result.active_projects).toEqual([
      expect.objectContaining({
        id: "shared-agent-bridge",
        name: "Shared Agent Bridge",
        status: "active",
        phase: "bridge reliability"
      })
    ]);
    expect(result.roadmap).toEqual([
      expect.objectContaining({
        project_id: "shared-agent-bridge",
        milestone: "Project memory v1",
        state: "active"
      })
    ]);
    expect(result.paused_ideas).toEqual([
      expect.objectContaining({
        project_id: "shared-agent-bridge",
        title: "Dream report scheduler"
      })
    ]);
    expect(result.research_watchlist).toEqual([
      expect.objectContaining({
        project_id: "shared-agent-bridge",
        topic: "Local research routes"
      })
    ]);
    expect(result.recent_results[0]?.source).toBe(".chatgpt/codex-runs/2026-06-08T031000Z-concurrency-canary-a/RESULT.md");
    expect(result.suggested_next_moves).toEqual([
      { project_id: "shared-agent-bridge", move: "Write a dashboard reader." }
    ]);
    expect(result.artifacts[0]).toMatchObject({ artifact_id: "proof-image", project_id: "shared-agent-bridge", kind: "image" });
    expect(result.dream_report_template_path).toBe(".chatgpt/project-memory/dream-report-template.md");
    expect(result.source_paths).toEqual([".chatgpt/project-memory/projects.json"]);
    expect(result.source_project_counts).toEqual({ ".chatgpt/project-memory/projects.json": 1 });
    expect(result.warnings).toEqual([]);
  });

  test("merges the tracked portfolio with local-only records and canonicalizes aliases", async () => {
    const fixture = await createRepoFixture();
    await mkdir(join(fixture.root, ".chatgpt", "project-memory"), { recursive: true });
    await mkdir(join(fixture.root, "shared", "state"), { recursive: true });
    await writeFile(join(fixture.root, ".chatgpt", "project-memory", "projects.json"), JSON.stringify({
      schema_version: 1,
      generated_at: "2026-06-08T03:20:00Z",
      projects: [
        {
          id: "shared-agent-bridge", name: "Old Bridge", status: "active", phase: "old",
          product_track: "old", confidence: "draft", summary: "Old summary."
        },
        {
          id: "local-only", name: "Local Only", status: "draft", phase: "idea",
          product_track: "experiment", confidence: "low", summary: "Preserve me."
        }
      ]
    }));
    await writeFile(join(fixture.root, "shared", "state", "project_memory_v1.json"), JSON.stringify({
      schema_version: 1,
      updated_at: "2026-06-25T22:49:54Z",
      projects: [{
        key: "bridge", label: "Bridge", status: "active", phase: "current",
        product_track: "execution", confidence: "high", summary: "Current summary.",
        roadmap: [{ item: "Current slice", state: "active", next_step: "Verify it." }],
        next_moves: ["Continue safely"]
      }]
    }));

    const result = await new ProjectMemoryService({
      repo_id: "fixture", display_name: "Fixture", root: fixture.root
    }, new PathSandbox(fixture.root)).dashboard();

    expect(result.generated_at).toBe("2026-06-25T22:49:54Z");
    expect(result.project_count).toBe(2);
    expect(result.active_projects).toEqual([
      expect.objectContaining({ id: "shared-agent-bridge", name: "Shared Agent Bridge", phase: "current" }),
      expect.objectContaining({ id: "local-only", name: "Local Only" })
    ]);
    expect(result.roadmap).toEqual([expect.objectContaining({
      project_id: "shared-agent-bridge", milestone: "Current slice"
    })]);
    expect(result.source_paths).toEqual([
      ".chatgpt/project-memory/projects.json",
      "shared/state/project_memory_v1.json"
    ]);
    expect(result.source_project_counts).toEqual({
      ".chatgpt/project-memory/projects.json": 2,
      "shared/state/project_memory_v1.json": 1
    });
    expect(result.warnings).toEqual([]);
  });

  test("returns an empty dashboard warning when project memory has not been seeded", async () => {
    const fixture = await createRepoFixture();

    const result = await new ProjectMemoryService({
      repo_id: "fixture",
      display_name: "Fixture",
      root: fixture.root
    }, new PathSandbox(fixture.root)).dashboard();

    expect(result).toMatchObject({
      ok: true,
      repo_id: "fixture",
      project_count: 0,
      active_projects: [],
      warnings: ["PROJECT_MEMORY_NOT_FOUND"]
    });
  });
});
