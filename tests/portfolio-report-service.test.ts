import { describe, expect, test } from "vitest";
import { PortfolioReportService } from "../src/services/portfolio-report-service.js";
import {
  clearAdvisorBatchCache,
  generateAdvisorCard,
  generateAdvisorCardWithHermes,
  hydrateAdvisorBatchForProject,
} from "../src/services/portfolio-advisor-generation-service.js";
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
    expect(result.project_workspaces.find((project) => project.id === "beta")?.latest_evidence_at).toBe("");
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

  test("builds project-scoped advisor reports with revision and contradiction edges", () => {
    const result = new PortfolioReportService().build("shared-agent-bridge", memory, { project_ids: ["alpha"] });
    const report = result.advisor_reports[0];
    expect(report?.project_id).toBe("alpha");
    expect(report?.snapshot_id).toContain("portfolio:alpha:");
    expect(report?.cards).toHaveLength(9);
    expect(report?.cards.find((card) => card.advisor_id === "critic")?.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ advisor_id: "fan", type: "contradicts" })
    ]));
    expect(report?.freshness).toBe("stale");
    expect(report?.evidence_fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  test("attaches an explicit provenance-backed evidence-state packet to each advisor snapshot", () => {
    const result = new PortfolioReportService().build("shared-agent-bridge", memory, { project_ids: ["alpha"] });
    const packet = result.advisor_reports[0]?.evidence_state_packet;

    expect(packet?.states_explicit).toBe(true);
    expect(packet?.active.find((item) => item.title === "Finish the bounded slice")?.provenance[0]).toMatchObject({
      source_kind: "roadmap",
      source_path: "project_memory.roadmap",
    });
    expect(packet?.completed.find((item) => item.title === "Live route verified.")?.provenance[0]).toMatchObject({
      source_kind: "recent_result",
      source_path: "RESULT.md",
    });
    expect(packet?.eligible_work_ids.every((workId) =>
      !packet.completed.some((item) => item.work_id === workId)
      && !packet.superseded.some((item) => item.work_id === workId)
      && !packet.unknown.some((item) => item.work_id === workId)
    )).toBe(true);
    expect(packet?.translation_boundary).toContain("Never dispatch");
  });

  test("changes the advisor evidence fingerprint when project ledger evidence changes", () => {
    const before = new PortfolioReportService().build("shared-agent-bridge", memory, { project_ids: ["alpha"] });
    const after = new PortfolioReportService().build("shared-agent-bridge", memory, { project_ids: ["alpha"] }, {
      entries: [{ action_id: "alpha-slice", report_id: "report", project_id: "alpha", project_name: "Alpha", title: "Alpha slice", route: "continue_slice", risk: "approval_required", state: "working", attempt_count: 1, updated_at: "2026-07-17T00:00:00Z", reason: "Selected", receipt_summary: "", snooze_until: "" }],
      activity: []
    });
    expect(after.advisor_reports[0]?.evidence_fingerprint).not.toBe(before.advisor_reports[0]?.evidence_fingerprint);
    expect(after.advisor_reports[0]?.snapshot_id).not.toBe(before.advisor_reports[0]?.snapshot_id);
  });

  test("generates a replacement advisor card only for the current snapshot", () => {
    const report = new PortfolioReportService().build("shared-agent-bridge", memory, { project_ids: ["alpha"] });
    const source = report.advisor_reports[0]!;
    const generated = generateAdvisorCard({ repo_id: "shared-agent-bridge", project_id: "alpha", advisor_id: "critic", snapshot_id: source.snapshot_id, decision: "declined", prior_idea_title: source.cards.find((card) => card.advisor_id === "critic")!.idea_title, excluded_titles: [] }, report);
    expect(generated.generation_source).toBe("evidence_fallback");
    expect(generated.idea_title).not.toBe(source.cards.find((card) => card.advisor_id === "critic")!.idea_title);
    expect(generated.evidence_work_ids.length).toBeGreaterThan(0);
    expect(generated.dispatch_allowed).toBe(false);
    expect(generated.translation_boundary).toContain("translation-only");
    expect(() => generateAdvisorCard({ repo_id: "shared-agent-bridge", project_id: "alpha", advisor_id: "critic", snapshot_id: "stale", decision: "accepted", prior_idea_title: generated.idea_title, excluded_titles: [] }, report)).toThrow("ADVISOR_GENERATION_STALE_SNAPSHOT");
  });

  test("maps a validated Hermes GPT-5.4 advisor replacement onto the current snapshot", async () => {
    const report = new PortfolioReportService().build("shared-agent-bridge", memory, { project_ids: ["alpha"] });
    const source = report.advisor_reports[0]!;
    const prior = source.cards.find((card) => card.advisor_id === "critic")!;
    let capturedPrompt = "";
    const generated = await generateAdvisorCardWithHermes({
      repo_id: "shared-agent-bridge",
      project_id: "alpha",
      advisor_id: "critic",
      snapshot_id: source.snapshot_id,
      decision: "declined",
      prior_idea_title: prior.idea_title,
      excluded_titles: [prior.idea_title],
    }, report, async (prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        status: "card",
        idea_title: "Verify the active slice against one failure case",
        quick_take: "Test one failure case before continuing",
        description: "Run one bounded check against the active work and record whether it passes.",
        evidence_work_ids: [source.evidence_state_packet.eligible_work_ids[0]],
        relationships: [{ type: "supports", work_id: source.evidence_state_packet.eligible_work_ids[0] }],
        abstention_reason: null,
      });
    });
    expect(generated.generation_source).toBe("model");
    expect(generated.dispatch_allowed).toBe(false);
    expect(generated.evidence_work_ids).toEqual([source.evidence_state_packet.eligible_work_ids[0]]);
    expect(generated.relations).toEqual([]);
    expect(capturedPrompt).toContain("materially different angle");
    expect(capturedPrompt).toContain(source.snapshot_id);
    expect(capturedPrompt).toContain("Do not inspect files");
    expect(capturedPrompt).toContain("Do not calculate or paraphrase evidence age");
  });

  test("rejects Hermes advisor output that cites ineligible work", async () => {
    const report = new PortfolioReportService().build("shared-agent-bridge", memory, { project_ids: ["alpha"] });
    const source = report.advisor_reports[0]!;
    const prior = source.cards.find((card) => card.advisor_id === "critic")!;
    await expect(generateAdvisorCardWithHermes({
      repo_id: "shared-agent-bridge",
      project_id: "alpha",
      advisor_id: "critic",
      snapshot_id: source.snapshot_id,
      decision: "declined",
      prior_idea_title: prior.idea_title,
      excluded_titles: [],
    }, report, async () => JSON.stringify({
      status: "card",
      idea_title: "Bad evidence",
      quick_take: "Use unsupported evidence",
      description: "This output should be rejected.",
      evidence_work_ids: ["work_not_eligible"],
      relationships: [],
      abstention_reason: "",
    }))).rejects.toThrow("ADVISOR_GENERATION_INVALID_EVIDENCE");
  });

  test("abstains from replacement generation when the packet has no eligible work", () => {
    const completedOnly = {
      ...memory,
      roadmap: [], research_watchlist: [], suggested_next_moves: [], paused_ideas: [],
      recent_results: [{ project_id: "alpha", project_name: "Alpha", date: "2026-07-18", summary: "The bounded Alpha slice completed and was accepted.", source: "RESULT.md" }],
    };
    const report = new PortfolioReportService().build("shared-agent-bridge", completedOnly, { project_ids: ["alpha"] });
    const source = report.advisor_reports[0]!;

    expect(source.evidence_state_packet.eligible_work_ids).toEqual([]);
    expect(() => generateAdvisorCard({ repo_id: "shared-agent-bridge", project_id: "alpha", advisor_id: "critic", snapshot_id: source.snapshot_id, decision: "declined", prior_idea_title: source.cards[0]!.idea_title, excluded_titles: [] }, report))
      .toThrow("ADVISOR_GENERATION_ABSTAINED");
  });

  test("ranks active execution first and distributes the action cap across projects", () => {
    const result = new PortfolioReportService().build(
      "shared-agent-bridge",
      memory,
      { include_paused: true, max_actions: 2 },
      {
        entries: [{
          action_id: "working-beta", report_id: "report", project_id: "beta", project_name: "Beta",
          title: "Working beta", route: "continue_slice", risk: "approval_required", state: "working",
          attempt_count: 1, updated_at: "2026-07-15T00:00:00Z", reason: "In progress",
          receipt_summary: "", snooze_until: ""
        }],
        activity: []
      }
    );
    expect(result.projects[0]?.id).toBe("beta");
    expect(result.project_workspaces[0]?.id).toBe("beta");
    expect(result.actions).toHaveLength(2);
    expect(new Set(result.actions.map((action) => action.project_id))).toEqual(new Set(["alpha", "beta"]));
  });

  test("paginates more than thirty legitimate suggestions without discarding them", () => {
    const expanded = {
      ...memory,
      suggested_next_moves: Array.from({ length: 55 }, (_, index) => ({ project_id: "alpha", move: `Legitimate slice ${index + 1}` }))
    };
    const first = new PortfolioReportService().build("shared-agent-bridge", expanded, { max_actions: 30 });
    const second = new PortfolioReportService().build("shared-agent-bridge", expanded, { max_actions: 30, cursor: first.next_cursor });
    expect(first.actions).toHaveLength(30);
    expect(first.total_action_count).toBeGreaterThanOrEqual(50);
    expect(first.next_cursor).not.toBe("");
    expect(new Set([...first.actions, ...second.actions].map((action) => action.action_id)).size).toBe(first.actions.length + second.actions.length);
  });

  test("retires a stale suggestion when completion evidence proves it satisfied", () => {
    const completed = {
      ...memory,
      suggested_next_moves: [{ project_id: "alpha", move: "Install release 0.5.0 and verify OTA" }],
      recent_results: [{ project_id: "alpha", project_name: "Alpha", date: "2026-07-16", summary: "Release 0.5.0 installed successfully and OTA verified on Pixel.", source: "CURRENT_STATE.md" }]
    };
    const result = new PortfolioReportService().build("shared-agent-bridge", completed, { max_actions: 30 });
    expect(result.actions.map((action) => action.title)).not.toContain("Install release 0.5.0 and verify OTA");
    expect(result.hidden_action_count).toBeGreaterThan(0);
  });

  test("promotes ready existing Idea Inbox records into deduplicated project suggestions", () => {
    const result = new PortfolioReportService().build("shared-agent-bridge", memory, { max_actions: 30 }, undefined, undefined, ["alpha"], [], [{
      idea_id: "idea-alpha", captured_at: "2026-07-16T20:00:00.000Z", updated_at: "2026-07-16T20:00:00.000Z", dedupe_key: "key",
      raw_phrase: "Add a compact recovery heartbeat", normalized_title: "Add compact recovery heartbeat", status: "ready_for_slice",
      related_projects: ["alpha"], urgency: "medium", visibility_target: "portfolio_suggestion", next_prompt: "What is the smallest poll?",
      tags: ["recovery"], source_kind: "codex"
    }]);
    expect(result.actions.find((action) => action.title === "Add compact recovery heartbeat")).toMatchObject({ project_id: "alpha", risk: "approval_required" });
  });

  test("surfaces an active direct Codex project without granting launch access", () => {
    const goal = {
      version: 1 as const, goal_id: "goal-lead-follow", idempotency_key: "codex-lead-follow",
      project_id: "lead-and-follow", project_name: "Lead and Follow", repository_id: "lead-and-follow",
      action_id: "", objective: "Refine the phone-first ballroom lesson.", source_kind: "codex" as const,
      source_reference: "codex-task", plan: [], dependencies: [], parallel_wave: 0, serial_after: [],
      executor: "codex" as const, routing_reason: "Direct repository work", execution_scope: [],
      privacy_scope: "private_local" as const, proof_boundary: "Repo-local verification", hermes_transaction: "",
      hermes_board: "", hermes_task: "", hermes_cursor: "", codex_arbiter: "Codex",
      satisfaction_threshold: 95 as const, satisfaction_score: 72, iteration: 1, unmet_dimensions: ["runtime proof"],
      evidence: [], artifacts: [], changed_files: [], state: "working" as const, provisional_completion: false,
      final_acceptance: false, cancellation_reason: "", intervention: "", retry_count: 0,
      created_at: "2026-07-16T20:00:00.000Z", updated_at: "2026-07-16T21:00:00.000Z",
      heartbeat_at: "2026-07-16T21:00:00.000Z", terminal_at: "", events: []
    };
    const result = new PortfolioReportService().build(
      "shared-agent-bridge", memory, { max_actions: 30 }, undefined, undefined, [], [goal]
    );

    expect(result.projects.find((project) => project.id === "lead-and-follow")).toMatchObject({
      name: "Lead and Follow", phase: "direct Codex working"
    });
    expect(result.project_workspaces.find((project) => project.id === "lead-and-follow")?.latest_evidence_at)
      .toBe("2026-07-16T21:00:00.000Z");
    expect(result.actions.filter((action) => action.project_id === "lead-and-follow").every((action) => !action.launch_ready))
      .toBe(true);
  });

  test("generates all nine advisors once and reuses the batch for an unchanged snapshot", async () => {
    clearAdvisorBatchCache();
    const report = new PortfolioReportService().build("shared-agent-bridge", memory, { project_ids: ["alpha"] });
    const advisorReport = report.advisor_reports[0]!;
    const evidenceWorkId = advisorReport.evidence_state_packet.eligible_work_ids[0]!;
    let dispatchCount = 0;
    const dispatch = async () => {
      dispatchCount += 1;
      return JSON.stringify({
        project_id: "alpha",
        snapshot_id: advisorReport.snapshot_id,
        outcomes: advisorReport.cards.map((card, index) => ({
          advisor_id: card.advisor_id,
          kind: index === 7 ? "perspective" : index === 8 ? "abstain" : "actionable",
          idea_title: index === 8 ? "" : `${card.name} move`,
          quick_take: index === 8 ? "No evidence-backed recommendation" : `Advance ${card.focus.toLowerCase()}`,
          description: index === 8 ? "" : `Use ${evidenceWorkId} to produce one bounded result with a visible receipt.`,
          evidence_work_ids: index === 8 ? [] : [evidenceWorkId],
          relationships: [],
          abstention_reason: index === 8 ? "This advisor lacks distinct evidence for the current snapshot." : "",
        })),
      });
    };

    const generated = await hydrateAdvisorBatchForProject(report, "alpha", dispatch);
    const cached = await hydrateAdvisorBatchForProject(report, "alpha", dispatch);

    expect(dispatchCount).toBe(1);
    expect(generated.advisor_reports[0]).toMatchObject({
      advisor_generation_source: "model",
      advisor_generation_status: "generated",
    });
    expect(cached.advisor_reports[0]?.advisor_generation_status).toBe("cached");
    expect(generated.advisor_reports[0]?.cards).toHaveLength(9);
    expect(generated.advisor_reports[0]?.cards.filter((card) => card.control_mode === "yes_no")).toHaveLength(7);
    expect(generated.advisor_reports[0]?.cards.filter((card) => card.control_mode === "none")).toHaveLength(2);
  });

  test("generates a new batch after the project snapshot changes", async () => {
    clearAdvisorBatchCache();
    const first = new PortfolioReportService().build("shared-agent-bridge", memory, { project_ids: ["alpha"] });
    const changedMemory = {
      ...memory,
      suggested_next_moves: [...memory.suggested_next_moves, { project_id: "alpha", move: "Verify the changed snapshot route" }],
    };
    const second = new PortfolioReportService().build("shared-agent-bridge", changedMemory, { project_ids: ["alpha"] });
    let dispatchCount = 0;
    const dispatchFor = (source: typeof first) => async () => {
      dispatchCount += 1;
      const advisorReport = source.advisor_reports[0]!;
      const evidenceWorkId = advisorReport.evidence_state_packet.eligible_work_ids[0]!;
      return JSON.stringify({
        project_id: "alpha",
        snapshot_id: advisorReport.snapshot_id,
        outcomes: advisorReport.cards.map((card) => ({
          advisor_id: card.advisor_id,
          kind: "actionable",
          idea_title: `${card.name} changed-snapshot move`,
          quick_take: "Produce one bounded changed-snapshot result",
          description: `Use ${evidenceWorkId} and preserve a visible receipt.`,
          evidence_work_ids: [evidenceWorkId],
          relationships: [],
          abstention_reason: "",
        })),
      });
    };

    await hydrateAdvisorBatchForProject(first, "alpha", dispatchFor(first));
    await hydrateAdvisorBatchForProject(second, "alpha", dispatchFor(second));

    expect(first.advisor_reports[0]?.snapshot_id).not.toBe(second.advisor_reports[0]?.snapshot_id);
    expect(dispatchCount).toBe(2);
  });

  test("keeps deterministic cards and does not cache an invalid Hermes batch", async () => {
    clearAdvisorBatchCache();
    const report = new PortfolioReportService().build("shared-agent-bridge", memory, { project_ids: ["alpha"] });
    let dispatchCount = 0;
    const invalidDispatch = async () => {
      dispatchCount += 1;
      return JSON.stringify({ project_id: "alpha", snapshot_id: report.advisor_reports[0]!.snapshot_id, outcomes: [] });
    };

    const first = await hydrateAdvisorBatchForProject(report, "alpha", invalidDispatch);
    const second = await hydrateAdvisorBatchForProject(report, "alpha", invalidDispatch);

    expect(first.advisor_reports[0]?.advisor_generation_status).toBe("fallback");
    expect(second.advisor_reports[0]?.advisor_generation_status).toBe("fallback");
    expect(dispatchCount).toBe(2);
  });
});
