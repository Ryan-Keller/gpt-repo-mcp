import { createHash } from "node:crypto";
import type { PortfolioReportInput, PortfolioReportResult } from "../contracts/portfolio-report.contract.js";
import type { ProjectMemoryDashboardResult } from "../contracts/project-memory.contract.js";
import type { PortfolioActionLedgerSnapshot } from "./portfolio-action-ledger-service.js";
import type { PortfolioConsoleState } from "../contracts/portfolio-console-state.contract.js";
import type { GoalRecord } from "../contracts/goal-record.contract.js";

type Options = Omit<PortfolioReportInput, "repo_id">;

export class PortfolioReportService {
  build(repoId: string, memory: ProjectMemoryDashboardResult, options: Options = {}, ledger: PortfolioActionLedgerSnapshot = { entries: [], activity: [] }, consoleState: PortfolioConsoleState = { version: 1, updated_at: "", project_seen: [], playbooks: [], artifacts: [] }, approvedRepoIds: string[] = [], goals: GoalRecord[] = []): PortfolioReportResult {
    const now = new Date();
    const requested = new Set(options.project_ids ?? []);
    const sourceProjects = memory.active_projects.filter((project) =>
      (!requested.size || requested.has(project.id)) && (options.include_paused || project.status !== "paused")
    );
    const ids = new Set(sourceProjects.map((project) => project.id));
    const topics = options.topics?.length ? options.topics : ["active work", "risks and verification", "next slices", "research watchlist"];
    const sourceDate = Date.parse(memory.generated_at);
    const sourceAgeDays = Number.isFinite(sourceDate) ? Math.max(0, Math.floor((now.getTime() - sourceDate) / 86_400_000)) : -1;
    const freshness = sourceAgeDays < 0 ? "unknown" : sourceAgeDays <= 7 ? "fresh" : sourceAgeDays <= 30 ? "aging" : "stale";
    const roadmap = memory.roadmap.filter((item) => ids.has(item.project_id));
    const watch = memory.research_watchlist.filter((item) => ids.has(item.project_id));
    const results = memory.recent_results.filter((item) => ids.has(item.project_id));
    const paused = memory.paused_ideas.filter((item) => ids.has(item.project_id));
    const moves = memory.suggested_next_moves.filter((item) => ids.has(item.project_id));
    const projectName = (id: string) => sourceProjects.find((project) => project.id === id)?.name ?? id;
    const latestEvidenceByProject = new Map(sourceProjects.map((project) => {
      const evidenceCandidates = [
        ...results.filter((item) => item.project_id === project.id).map((item) => item.date),
        ...ledger.entries.filter((entry) => entry.project_id === project.id).map((entry) => entry.updated_at)
      ].map((value) => Date.parse(value)).filter(Number.isFinite);
      return [project.id, evidenceCandidates.length ? Math.max(...evidenceCandidates) : 0] as const;
    }));
    const activeActionCount = (projectId: string) => ledger.entries.filter((entry) =>
      entry.project_id === projectId && (entry.state === "routed" || entry.state === "working")
    ).length;
    const projects = [...sourceProjects].sort((left, right) =>
      activeActionCount(right.id) - activeActionCount(left.id)
      || (latestEvidenceByProject.get(right.id) ?? 0) - (latestEvidenceByProject.get(left.id) ?? 0)
      || statusPriority(right.status) - statusPriority(left.status)
      || left.name.localeCompare(right.name)
    );
    const actionCandidates: PortfolioReportResult["actions"] = [];
    const handledEntries = ledger.entries.filter((entry) => entry.state !== "available" && !(entry.state === "snoozed" && Date.parse(entry.snooze_until) <= now.getTime()));
    const handled = new Set(handledEntries.map((entry) => entry.action_id));
    let hiddenActionCount = 0;
    const add = (projectId: string, title: string, rationale: string, source: string, route: PortfolioReportResult["actions"][number]["route"], risk: PortfolioReportResult["actions"][number]["risk"]) => {
      const actionId = "a_" + createHash("sha256").update(`${projectId}:${source}:${title}`).digest("hex").slice(0, 10);
      if (handled.has(actionId)) { hiddenActionCount++; return; }
      const targetRepoId = approvedRepoIds.find((candidate) => normalizeId(candidate) === normalizeId(projectId)) ?? "";
      if (isSatisfiedByEvidence(projectId, title, results)) { hiddenActionCount++; return; }
      if (actionCandidates.some((candidate) => candidate.project_id === projectId && normalizeText(candidate.title) === normalizeText(title))) return;
      actionCandidates.push({
        action_id: actionId, project_id: projectId, project_name: projectName(projectId), title, rationale, source, route, risk,
        prompt: `For project ${projectId}, ${title}. First verify current repo evidence. Then use the safest appropriate Shared Agent Bridge route. ${risk === "approval_required" ? "Request approval before any mutation." : "Keep this read-only unless I explicitly approve a change."}`,
        target_repo_id: targetRepoId,
        launch_ready: Boolean(targetRepoId) && risk === "read_only"
      });
    };
    for (const project of projects.filter((p) => p.confidence !== "high")) add(project.id, "Verify current project state", `Memory confidence is ${project.confidence}; phase is ${project.phase}.`, "project confidence", "verify_project", "read_only");
    for (const move of moves) add(move.project_id, move.move, "Suggested by persistent project memory.", "suggested next move", "continue_slice", "approval_required");
    for (const item of roadmap) add(item.project_id, item.next_step, `${item.milestone} is ${item.state}.`, "roadmap", "continue_slice", "approval_required");
    for (const item of watch) add(item.project_id, `Review: ${item.topic}`, `Watch status ${item.status}; cadence ${item.cadence}.`, "research watchlist", "research", "read_only");
    for (const idea of paused) add(idea.project_id, idea.next_tiny_experiment, `Paused: ${idea.reason_paused}`, "paused idea", "resume_experiment", "approval_required");
    for (const result of results.slice(0, 8)) add(result.project_id, `Review result from ${result.date}`, result.summary, result.source, "review_result", "read_only");
    const allActions = distributeActions(actionCandidates, projects.map((project) => project.id), Number.MAX_SAFE_INTEGER);
    const pageSize = Math.min(options.max_actions ?? 20, 30);
    const offset = parseCursor(options.cursor);
    const actions = allActions.slice(offset, offset + pageSize);
    const nextCursor = offset + pageSize < allActions.length ? `p_${offset + pageSize}` : "";
    const warnings = [...memory.warnings];
    if (freshness === "stale") warnings.push(`PROJECT_MEMORY_STALE:${sourceAgeDays}_DAYS`);
    if (requested.size && projects.length !== requested.size) warnings.push("SOME_REQUESTED_PROJECTS_NOT_FOUND");
    const sections = [
      { topic: "Active portfolio", headline: `${projects.length} relevant projects`, items: projects.map((p) => `${p.name}: ${p.status} · ${p.phase} · confidence ${p.confidence}`) },
      { topic: "Roadmap", headline: `${roadmap.length} current milestones`, items: roadmap.map((i) => `${i.project_name}: ${i.milestone} — ${i.next_step}`) },
      { topic: "Research", headline: `${watch.length} watched topics`, items: watch.map((i) => `${i.project_name}: ${i.topic} (${i.status})`) },
      { topic: "Recent evidence", headline: `${results.length} recorded results`, items: results.slice(0, 10).map((i) => `${i.project_name} · ${i.date}: ${i.summary}`) }
    ];
    const observed = now.toISOString();
    const projectWorkspaces: PortfolioReportResult["project_workspaces"] = projects.map((project) => {
      const projectRoadmap = roadmap.filter((item) => item.project_id === project.id);
      const projectResults = results.filter((item) => item.project_id === project.id);
      const projectMoves = moves.filter((item) => item.project_id === project.id);
      const projectWatch = watch.filter((item) => item.project_id === project.id);
      const artifactSource = [...memory.artifacts, ...consoleState.artifacts.map((item) => ({ ...item, project_name: projectName(item.project_id) }))];
      const projectArtifacts = [...new Map(artifactSource.filter((item) => item.project_id === project.id).map((item) => [item.artifact_id, item])).values()].map((item) => ({
        artifact_id: item.artifact_id, project_id: item.project_id, title: item.title, kind: item.kind,
        source: item.source, observed_at: item.observed_at, mime_type: item.mime_type,
        preview_url: item.preview_url, open_url: item.open_url,
        previewable: Boolean(item.preview_url) && (item.kind === "image" || item.kind === "video" || item.kind === "audio")
      }));
      const projectLedger = ledger.entries.filter((entry) => entry.project_id === project.id);
      const evidenceCandidates = [
        ...projectResults.map((item) => item.date),
        ...projectLedger.map((entry) => entry.updated_at)
      ].map((value) => Date.parse(value)).filter(Number.isFinite);
      const latestEvidence = evidenceCandidates.length ? new Date(Math.max(...evidenceCandidates)).toISOString() : "";
      const milestones = projectRoadmap.map((item) => `${item.milestone} [${item.state}] — ${item.next_step}`);
      const recent = projectResults.slice(0, 5).map((item) => `${item.date}: ${item.summary} (${item.source})`);
      const nextMoves = projectMoves.map((item) => item.move);
      const watchTopics = projectWatch.map((item) => `${item.topic} [${item.status}; ${item.cadence}]`);
      const packet = {
        project_id: project.id, project_name: project.name, status: project.status, phase: project.phase,
        product_track: project.product_track, confidence: project.confidence, summary: project.summary,
        source_generated_at: memory.generated_at, latest_evidence_at: latestEvidence,
        milestones, recent_results: recent, next_moves: nextMoves, watch_topics: watchTopics,
        artifacts: projectArtifacts.map((item) => `${item.kind}: ${item.title} — ${item.source}`),
        active_actions: projectLedger.filter((entry) => entry.state === "routed" || entry.state === "working").map((entry) => `${entry.state}: ${entry.title}`)
      };
      const reentryPrompt = [
        `Resume the ${project.name} project from this Shared Agent Bridge re-entry packet.`,
        "Treat the packet as orientation, not unquestionable current truth.",
        `First call repo_bridge_concierge for repo_id \"shared-agent-bridge\" with a request to resolve the current ${project.name} project destination and include evidence.`,
        "Then verify the resolved project's current onboarding, runtime, dirty state, and newest receipts before proposing or continuing work.",
        "Report: what the project is, current phase and product track, runtime status, what changed, active work, top unknowns, and the smallest useful next choices.",
        "Do not duplicate any routed or working action. Preserve approval boundaries for mutations and durable dispatch.",
        "REENTRY_PACKET_V1",
        JSON.stringify(packet, null, 2)
      ].join("\n\n");
      return {
        id: project.id, name: project.name, status: project.status, phase: project.phase,
        product_track: project.product_track, confidence: project.confidence, summary: project.summary,
        latest_evidence_at: latestEvidence, active_action_count: projectLedger.filter((entry) => entry.state === "routed" || entry.state === "working").length,
        handled_action_count: projectLedger.filter((entry) => entry.state !== "available").length,
        milestones, recent_results: recent, next_moves: nextMoves, watch_topics: watchTopics, artifacts: projectArtifacts, reentry_prompt: reentryPrompt
      };
    });
    return {
      ok: true, repo_id: repoId, report_id: `portfolio-${observed.replace(/\D/g, "").slice(0, 14)}`,
      generated_at: observed, source_generated_at: memory.generated_at, source_age_days: sourceAgeDays,
      registry_sources: memory.source_paths ?? [memory.memory_root],
      registry_source_counts: Object.entries(memory.source_project_counts ?? { [memory.memory_root]: memory.project_count })
        .map(([path, project_count]) => ({ path, project_count })),
      freshness, title: "Portfolio action console",
      summary: `${projects.length} projects · ${actions.length} selectable actions · ${hiddenActionCount} handled · ${(memory.source_paths ?? [memory.memory_root]).length} registry sources · evidence ${freshness}`,
      topics, projects, sections, project_workspaces: projectWorkspaces, console_state: consoleState, actions,
      active_actions: ledger.entries.filter((entry) => entry.state === "routed" || entry.state === "working").sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      history_actions: ledger.entries.filter((entry) => ["completed", "stopped", "snoozed", "archived"].includes(entry.state)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      recent_activity: ledger.activity.slice(0, 30), hidden_action_count: hiddenActionCount,
      active_goals: goals.filter((goal) => !["accepted", "cancelled", "archived", "failed"].includes(goal.state)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      goal_history: goals.filter((goal) => ["accepted", "cancelled", "archived", "failed"].includes(goal.state)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 50),
      next_cursor: nextCursor, total_action_count: allActions.length, choice_sufficient: allActions.length >= 2, warnings,
      next_action: "review_actions_select_several_then_send_one_decision_bundle_to_chatgpt"
    };
  }
}

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCursor(cursor?: string): number {
  if (!cursor) return 0;
  const match = /^p_(\d+)$/.exec(cursor);
  return match ? Number(match[1]) : 0;
}

function normalizeText(value: string): string { return value.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim(); }

function isSatisfiedByEvidence(projectId: string, title: string, results: ProjectMemoryDashboardResult["recent_results"]): boolean {
  const titleWords = new Set(normalizeText(title).split(" ").filter((word) => word.length > 3));
  const versions = title.match(/\b\d+\.\d+(?:\.\d+)?\b/g) ?? [];
  return results.some((result) => {
    if (result.project_id !== projectId) return false;
    const summary = normalizeText(result.summary);
    if (!/complete|completed|success|successful|verified|accepted|installed|shipped|released/.test(summary)) return false;
    if (versions.length && !versions.every((version) => summary.includes(version))) return false;
    const overlap = [...titleWords].filter((word) => summary.includes(word)).length;
    return overlap >= Math.min(2, titleWords.size);
  });
}

function statusPriority(status: string): number {
  const normalized = status.toLowerCase();
  if (/working|running|active|build|current|live/.test(normalized)) return 3;
  if (/ready|next|planned|seed/.test(normalized)) return 2;
  if (/paused|snoozed|archived|stopped/.test(normalized)) return 0;
  return 1;
}

function actionPriority(action: PortfolioReportResult["actions"][number]): number {
  const routePriority: Record<PortfolioReportResult["actions"][number]["route"], number> = {
    continue_slice: 6,
    verify_project: 5,
    research: 4,
    review_result: 3,
    resume_experiment: 2,
    ask_user: 1
  };
  return routePriority[action.route] ?? 0;
}

function distributeActions(
  candidates: PortfolioReportResult["actions"],
  rankedProjectIds: string[],
  maxActions: number
): PortfolioReportResult["actions"] {
  const grouped = new Map(rankedProjectIds.map((projectId) => [
    projectId,
    candidates.filter((action) => action.project_id === projectId)
      .sort((left, right) => actionPriority(right) - actionPriority(left) || left.title.localeCompare(right.title))
  ]));
  const distributed: PortfolioReportResult["actions"] = [];
  let round = 0;
  while (distributed.length < maxActions) {
    let added = false;
    for (const projectId of rankedProjectIds) {
      const action = grouped.get(projectId)?.[round];
      if (!action) continue;
      distributed.push(action);
      added = true;
      if (distributed.length >= maxActions) break;
    }
    if (!added) break;
    round++;
  }
  return distributed;
}
