import { createHash } from "node:crypto";
import type { GoalRecord } from "../contracts/goal-record.contract.js";
import type { PortfolioActionLedgerEntry } from "../contracts/portfolio-action.contract.js";
import type { IdeaRecord } from "../contracts/portfolio-intake.contract.js";
import type { PortfolioReportResult } from "../contracts/portfolio-report.contract.js";
import type { ProjectMemoryDashboardResult } from "../contracts/project-memory.contract.js";

type Project = ProjectMemoryDashboardResult["active_projects"][number];
type EvidenceState = "completed" | "superseded" | "active" | "blocked" | "open" | "unknown";
type EvidenceItem = PortfolioReportResult["advisor_reports"][number]["evidence_state_packet"][EvidenceState][number];
type Provenance = EvidenceItem["provenance"][number];

type BuildInput = {
  project: Project;
  sourceGeneratedAt: string;
  roadmap: ProjectMemoryDashboardResult["roadmap"];
  recentResults: ProjectMemoryDashboardResult["recent_results"];
  suggestedNextMoves: ProjectMemoryDashboardResult["suggested_next_moves"];
  ledgerEntries: PortfolioActionLedgerEntry[];
  goals: GoalRecord[];
  ideas: IdeaRecord[];
};

type Candidate = {
  identity: string;
  state: EvidenceState;
  title: string;
  detail: string;
  observedAt: string;
  provenance: Provenance;
};

const STATE_ORDER: EvidenceState[] = ["completed", "superseded", "active", "blocked", "open", "unknown"];
const TERMINAL_PRIORITY: Record<EvidenceState, number> = { completed: 6, superseded: 5, active: 4, blocked: 3, open: 2, unknown: 1 };

export function buildPortfolioAdvisorEvidenceStatePacket(input: BuildInput): PortfolioReportResult["advisor_reports"][number]["evidence_state_packet"] {
  const candidates: Candidate[] = [];
  const add = (candidate: Candidate) => candidates.push(candidate);
  const projectId = input.project.id;

  for (const item of input.roadmap.filter((value) => value.project_id === projectId)) {
    add({
      identity: `roadmap:${normalize(item.milestone || item.next_step)}`,
      state: classifyTextState(item.state),
      title: item.next_step || item.milestone,
      detail: `${item.milestone} [${item.state}]`,
      observedAt: input.sourceGeneratedAt,
      provenance: provenance("roadmap", "project_memory.roadmap", item.milestone, input.sourceGeneratedAt, `${item.state}: ${item.next_step}`),
    });
  }
  for (const item of input.recentResults.filter((value) => value.project_id === projectId)) {
    add({
      identity: `result:${normalize(item.summary)}`,
      state: classifyResult(item.summary),
      title: item.summary,
      detail: `Recorded result from ${item.date}`,
      observedAt: item.date,
      provenance: provenance("recent_result", item.source, "", item.date, item.summary),
    });
  }
  for (const item of input.suggestedNextMoves.filter((value) => value.project_id === projectId)) {
    add({
      identity: `move:${normalize(item.move)}`,
      state: "open",
      title: item.move,
      detail: "Suggested next move from project memory.",
      observedAt: input.sourceGeneratedAt,
      provenance: provenance("suggested_next_move", "project_memory.suggested_next_moves", "", input.sourceGeneratedAt, item.move),
    });
  }
  for (const entry of input.ledgerEntries.filter((value) => value.project_id === projectId)) {
    add({
      identity: `action:${entry.action_id}`,
      state: classifyLedgerState(entry.state),
      title: entry.title,
      detail: entry.receipt_summary || entry.reason || `Ledger state ${entry.state}`,
      observedAt: entry.updated_at,
      provenance: provenance("action_ledger", "portfolio_action_ledger", entry.action_id, entry.updated_at, `${entry.state}: ${entry.receipt_summary || entry.reason}`),
    });
  }
  for (const goal of input.goals.filter((value) => value.project_id === projectId)) {
    add({
      identity: goal.action_id ? `action:${goal.action_id}` : `goal:${goal.goal_id}`,
      state: classifyGoalState(goal.state),
      title: goal.objective,
      detail: goal.evidence.at(-1) || goal.intervention || goal.cancellation_reason || `Goal state ${goal.state}`,
      observedAt: goal.updated_at,
      provenance: provenance("goal", goal.source_reference || "goal_record", goal.goal_id, goal.updated_at, `${goal.state}: ${goal.objective}`),
    });
  }
  for (const idea of input.ideas.filter((value) => value.related_projects.includes(projectId))) {
    add({
      identity: idea.promoted_goal_id ? `goal:${idea.promoted_goal_id}` : `idea:${idea.idea_id}`,
      state: classifyIdeaState(idea.status),
      title: idea.normalized_title,
      detail: idea.reason || idea.raw_phrase,
      observedAt: idea.updated_at,
      provenance: provenance("idea", idea.source_reference || "idea_inbox", idea.idea_id, idea.updated_at, `${idea.status}: ${idea.raw_phrase}`),
    });
  }

  const terminalCandidates = candidates.filter((candidate) => candidate.state === "completed" || candidate.state === "superseded");
  for (const candidate of candidates.filter((value) => value.state === "open")) {
    const satisfyingEvidence = terminalCandidates.find((terminal) => textSatisfies(candidate.title, terminal.title));
    if (satisfyingEvidence) {
      candidate.identity = satisfyingEvidence.identity;
      candidate.observedAt = satisfyingEvidence.observedAt;
    }
  }

  const buckets = Object.fromEntries(STATE_ORDER.map((state) => [state, [] as EvidenceItem[]])) as Record<EvidenceState, EvidenceItem[]>;
  const grouped = new Map<string, Candidate[]>();
  for (const candidate of candidates) grouped.set(candidate.identity, [...(grouped.get(candidate.identity) ?? []), candidate]);

  for (const group of grouped.values()) {
    const selected = [...group].sort(compareCandidate)[0]!;
    const exclusionReason = exclusionReasonFor(selected.state, selected.title, selected.detail);
    const workId = `work_${createHash("sha256").update(`${projectId}:${selected.identity}`).digest("hex").slice(0, 12)}`;
    buckets[selected.state].push({
      work_id: workId,
      state: selected.state,
      title: selected.title,
      detail: selected.detail,
      observed_at: selected.observedAt,
      advisor_eligible: exclusionReason === "",
      exclusion_reason: exclusionReason,
      provenance: group.sort(compareCandidate).map((candidate) => candidate.provenance),
    });
  }
  for (const state of STATE_ORDER) buckets[state].sort((left, right) => right.observed_at.localeCompare(left.observed_at) || left.title.localeCompare(right.title));

  const eligibleWorkIds = ["active", "blocked", "open"]
    .flatMap((state) => buckets[state as EvidenceState])
    .filter((item) => item.advisor_eligible)
    .map((item) => item.work_id);
  return {
    version: 1,
    project_id: projectId,
    source_generated_at: input.sourceGeneratedAt,
    states_explicit: true,
    completed: buckets.completed,
    superseded: buckets.superseded,
    active: buckets.active,
    blocked: buckets.blocked,
    open: buckets.open,
    unknown: buckets.unknown,
    counts: Object.fromEntries(STATE_ORDER.map((state) => [state, buckets[state].length])) as Record<EvidenceState, number>,
    eligible_work_ids: eligibleWorkIds,
    translation_boundary: "Translate only eligible active, blocked, or open evidence into project-specific advice. Never dispatch. Abstain rather than inventing a path, claim, owner decision, or generic process task.",
  };
}

function provenance(sourceKind: Provenance["source_kind"], sourcePath: string, sourceId: string, observedAt: string, detail: string): Provenance {
  return { source_kind: sourceKind, source_path: sourcePath, source_id: sourceId, observed_at: observedAt, detail };
}

function compareCandidate(left: Candidate, right: Candidate): number {
  const leftTime = timestamp(left.observedAt);
  const rightTime = timestamp(right.observedAt);
  return rightTime - leftTime || TERMINAL_PRIORITY[right.state] - TERMINAL_PRIORITY[left.state];
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function classifyTextState(value: string): EvidenceState {
  const state = value.toLowerCase();
  if (/complete|completed|done|accepted|verified|shipped|released/.test(state)) return "completed";
  if (/supersed|replaced|obsolete|retired|cancelled|canceled|archived|stopped|rejected/.test(state)) return "superseded";
  if (/blocked|failed|waiting|paused|snoozed|hold/.test(state)) return "blocked";
  if (/active|working|running|progress|provisional|reviewing|launching/.test(state)) return "active";
  if (/open|planned|ready|next|todo|backlog|watch|captured|draft|seed/.test(state)) return "open";
  return "unknown";
}

function classifyResult(value: string): EvidenceState {
  const classified = classifyTextState(value);
  return classified === "unknown" ? "unknown" : classified;
}

function classifyLedgerState(value: PortfolioActionLedgerEntry["state"]): EvidenceState {
  if (value === "completed") return "completed";
  if (value === "stopped" || value === "archived") return "superseded";
  if (value === "routed" || value === "working") return "active";
  if (value === "snoozed") return "blocked";
  return "open";
}

function classifyGoalState(value: GoalRecord["state"]): EvidenceState {
  if (value === "accepted") return "completed";
  if (value === "cancelled" || value === "archived") return "superseded";
  if (["launching", "working", "provisional", "reviewing"].includes(value)) return "active";
  if (value === "blocked" || value === "failed") return "blocked";
  if (value === "planned") return "open";
  return "unknown";
}

function classifyIdeaState(value: IdeaRecord["status"]): EvidenceState {
  if (value === "rejected") return "superseded";
  if (value === "promoted") return "active";
  if (value === "parked" || value === "snoozed") return "blocked";
  return "open";
}

function exclusionReasonFor(state: EvidenceState, title: string, detail: string): EvidenceItem["exclusion_reason"] {
  if (state === "completed" || state === "superseded") return "terminal_state";
  if (state === "unknown") return "insufficient_evidence";
  const text = `${title} ${detail}`.toLowerCase();
  if (/\b(ask|wait for|needs?|requires?)\s+(ryan|the user|user|owner|operator|human)\b|\b(owner|operator|human)[ -]dependent\b/.test(text)) return "owner_dependent";
  if (/^(review|improve|continue|work on|plan|document)\s+(the\s+)?(project|process|work|next steps?)\.?$/i.test(title.trim())) return "generic_process";
  return "";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function textSatisfies(openTitle: string, terminalTitle: string): boolean {
  const versions = openTitle.match(/\b\d+\.\d+(?:\.\d+)?\b/g) ?? [];
  const normalizedTerminal = normalize(terminalTitle);
  if (versions.length && !versions.every((version) => terminalTitle.toLowerCase().includes(version))) return false;
  const words = normalize(openTitle).split(" ")
    .filter((word) => word.length > 3 && !["with", "from", "that", "this", "then", "next"].includes(word))
    .map((word) => word.slice(0, Math.min(5, word.length)));
  const overlap = new Set(words.filter((word) => normalizedTerminal.includes(word))).size;
  return overlap >= Math.min(2, new Set(words).size);
}
