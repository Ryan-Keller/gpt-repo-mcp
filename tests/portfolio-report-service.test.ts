import { describe, expect, test } from "vitest";
import { PortfolioReportService } from "../src/services/portfolio-report-service.js";
import type { ProjectMemoryDashboardResult } from "../src/contracts/project-memory.contract.js";

const memory: ProjectMemoryDashboardResult = {
  ok: true, repo_id: "shared-agent-bridge", memory_root: ".chatgpt/project-memory",
  generated_at: "2026-01-01T00:00:00Z", project_count: 2,
  active_projects: [
    { id: "alpha", name: "Alpha", status: "active", phase: "build", product_track: "product", confidence: "high", summary: "Active." },
    { id: "beta", name: "Beta", status: "paused", phase: "draft", product_track: "research", confidence: "low", summary: "Paused." }
  ],
  roadmap: [{ project_id: "alpha", project_name: "Alpha", milestone: "Slice one", state: "active", next_step: "Finish the bounded slice" }],
  paused_ideas: [{ project_id: "beta", project_name: "Beta", title: "Tiny test", reason_paused: "Needs focus", next_tiny_experiment: "Run one probe" }],
  research_watchlist: [{ project_id: "alpha", project_name: "Alpha", topic: "Latency", cadence: "weekly", status: "watching" }],
  recent_results: [{ project_id: "alpha", project_name: "Alpha", date: "2026-07-14", summary: "Live route verified.", source: "RESULT.md" }], suggested_next_moves: [{ project_id: "alpha", move: "Verify the live route" }],
  artifacts: [{ artifact_id: "proof-image", project_id: "alpha", project_name: "Alpha", title: "Proof image", kind: "image", source: "artifacts/proof.png", observed_at: "2026-07-14T10:00:00Z", mime_type: "image/png", preview_url: "https://example.com/proof.png", open_url: "https://example.com/proof.png" }],
  dream_report_template_path: ".chatgpt/project-memory/dream-report-template.md", warnings: []
};

describe("PortfolioReportService", () => {
  test("creates selectable evidence-derived actions and flags stale memory", () => {
    const result = new PortfolioReportService().build("shared-agent-bridge", memory, { include_paused: true, max_actions: 10 });
    expect(result.freshness).toBe("stale");
    expect(result.registry_sources).toEqual([".chatgpt/project-memory"]);
    expect(result.registry_source_counts).toEqual([{ path: ".chatgpt/project-memory", project_count: 2 }]);
    expect(result.warnings.some((warning) => warning.startsWith("PROJECT_MEMORY_STALE:"))).toBe(true);
    expect(result.actions.map((action) => action.title)).toContain("Finish the bounded slice");
    expect(result.actions.find((action) => action.project_id === "beta")?.title).toBe("Verify current project state");
    expect(new Set(result.actions.map((action) => action.action_id)).size).toBe(result.actions.length);
    expect(result.project_workspaces).toHaveLength(2);
    expect(result.project_workspaces[0]?.reentry_prompt).toContain("REENTRY_PACKET_V1");
    expect(result.project_workspaces[0]?.reentry_prompt).toContain("repo_bridge_concierge");
    expect(result.project_workspaces[0]?.recent_results[0]).toContain("Live route verified");
    expect(result.project_workspaces[0]?.artifacts[0]).toMatchObject({ title: "Proof image", previewable: true });
    expect(result.project_workspaces[0]?.reentry_prompt).toContain("artifacts/proof.png");
  });

  test("filters exact project ids and respects the action cap", () => {
    const result = new PortfolioReportService().build("shared-agent-bridge", memory, { project_ids: ["alpha"], max_actions: 2 });
    expect(result.projects.map((project) => project.id)).toEqual(["alpha"]);
    expect(result.actions).toHaveLength(2);
    expect(result.project_workspaces.map((project) => project.id)).toEqual(["alpha"]);
  });

  test("marks only approved read-only project actions launch-ready", () => {
    const result = new PortfolioReportService().build(
      "shared-agent-bridge",
      memory,
      { include_paused: true, max_actions: 10 },
      undefined,
      undefined,
      ["alpha"]
    );
    const alphaActions = result.actions.filter((action) => action.project_id === "alpha");
    expect(alphaActions.length).toBeGreaterThan(0);
    expect(alphaActions.every((action) => action.target_repo_id === "alpha")).toBe(true);
    expect(alphaActions.filter((action) => action.risk === "read_only").every((action) => action.launch_ready)).toBe(true);
    expect(result.actions.filter((action) => action.project_id === "beta").every((action) => !action.launch_ready)).toBe(true);
  });
});
