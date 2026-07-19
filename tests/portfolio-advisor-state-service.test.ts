import { describe, expect, test } from "vitest";
import { buildPortfolioAdvisorEvidenceStatePacket } from "../src/services/portfolio-advisor-state-service.js";

describe("buildPortfolioAdvisorEvidenceStatePacket", () => {
  test("separates all temporal states with provenance and excludes unsafe advisor work", () => {
    const packet = buildPortfolioAdvisorEvidenceStatePacket({
      project: { id: "lead-and-follow", name: "Lead and Follow", status: "active", phase: "prototype", product_track: "game", confidence: "high", summary: "Phone-first Godot slice." },
      sourceGeneratedAt: "2026-07-18T10:00:00.000Z",
      roadmap: [
        { project_id: "lead-and-follow", project_name: "Lead and Follow", milestone: "Runtime spine", state: "completed", next_step: "Verify the Day 1 spine" },
        { project_id: "lead-and-follow", project_name: "Lead and Follow", milestone: "Old widget route", state: "superseded", next_step: "Restore the widget route" },
        { project_id: "lead-and-follow", project_name: "Lead and Follow", milestone: "Phone polish", state: "active", next_step: "Polish the phone lesson" },
        { project_id: "lead-and-follow", project_name: "Lead and Follow", milestone: "Music generation", state: "blocked", next_step: "Generate final lesson music" },
        { project_id: "lead-and-follow", project_name: "Lead and Follow", milestone: "Partner mechanics", state: "planned", next_step: "Prototype partnered frame" },
        { project_id: "lead-and-follow", project_name: "Lead and Follow", milestone: "Unlabelled experiment", state: "maybe", next_step: "Investigate an unverified idea" },
      ],
      recentResults: [{ project_id: "lead-and-follow", project_name: "Lead and Follow", date: "2026-07-18", summary: "Day 1 spine completed and verified.", source: "docs/council/day1-reception-runtime-authored-pass-RESULT.md" }],
      suggestedNextMoves: [{ project_id: "lead-and-follow", move: "Ask Ryan to choose the final art direction" }],
      ledgerEntries: [],
      goals: [],
      ideas: [],
    });

    expect(packet.counts).toEqual({ completed: 2, superseded: 1, active: 1, blocked: 1, open: 2, unknown: 1 });
    expect(packet.completed.every((item) => item.advisor_eligible === false)).toBe(true);
    expect(packet.superseded.every((item) => item.advisor_eligible === false)).toBe(true);
    expect(packet.open.find((item) => item.title.includes("Ask Ryan"))).toMatchObject({
      advisor_eligible: false,
      exclusion_reason: "owner_dependent",
    });
    expect(packet.open.find((item) => item.title === "Prototype partnered frame")).toMatchObject({ advisor_eligible: true });
    expect(packet.unknown[0]?.exclusion_reason).toBe("insufficient_evidence");
    expect(packet.completed.flatMap((item) => item.provenance)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: "recent_result", source_path: "docs/council/day1-reception-runtime-authored-pass-RESULT.md" }),
    ]));
    expect(packet.eligible_work_ids).toEqual([
      packet.active[0]?.work_id,
      packet.blocked[0]?.work_id,
      packet.open.find((item) => item.title === "Prototype partnered frame")?.work_id,
    ]);
  });

  test("uses newer terminal evidence to retire duplicate open work", () => {
    const packet = buildPortfolioAdvisorEvidenceStatePacket({
      project: { id: "alpha", name: "Alpha", status: "active", phase: "build", product_track: "product", confidence: "high", summary: "Alpha." },
      sourceGeneratedAt: "2026-07-18T08:00:00.000Z",
      roadmap: [], recentResults: [], suggestedNextMoves: [], ideas: [],
      ledgerEntries: [
        { action_id: "same-action", report_id: "old", project_id: "alpha", project_name: "Alpha", title: "Ship bounded slice", route: "continue_slice", risk: "approval_required", state: "available", attempt_count: 0, updated_at: "2026-07-17T08:00:00.000Z", reason: "Suggested", receipt_summary: "", snooze_until: "" },
        { action_id: "same-action", report_id: "new", project_id: "alpha", project_name: "Alpha", title: "Ship bounded slice", route: "continue_slice", risk: "approval_required", state: "completed", attempt_count: 1, updated_at: "2026-07-18T08:00:00.000Z", reason: "Done", receipt_summary: "Verified", snooze_until: "" },
      ],
      goals: [],
    });

    expect(packet.completed).toHaveLength(1);
    expect(packet.open).toHaveLength(0);
    expect(packet.completed[0]?.provenance).toHaveLength(2);
    expect(packet.eligible_work_ids).toEqual([]);
  });

  test("retires differently worded open work when completion evidence satisfies it", () => {
    const packet = buildPortfolioAdvisorEvidenceStatePacket({
      project: { id: "alpha", name: "Alpha", status: "active", phase: "build", product_track: "product", confidence: "high", summary: "Alpha." },
      sourceGeneratedAt: "2026-07-18T08:00:00.000Z",
      roadmap: [], ledgerEntries: [], goals: [], ideas: [],
      suggestedNextMoves: [{ project_id: "alpha", move: "Install release 0.5.0 and verify OTA" }],
      recentResults: [{ project_id: "alpha", project_name: "Alpha", date: "2026-07-18", summary: "Release 0.5.0 installed successfully and OTA verified on Pixel.", source: "CURRENT_STATE.md" }],
    });

    expect(packet.completed).toHaveLength(1);
    expect(packet.open).toHaveLength(0);
    expect(packet.completed[0]?.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: "suggested_next_move" }),
      expect.objectContaining({ source_kind: "recent_result" }),
    ]));
    expect(packet.eligible_work_ids).toEqual([]);
  });
});
