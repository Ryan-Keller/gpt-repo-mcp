import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { PortfolioAdvisorGenerateInput, PortfolioAdvisorGeneratedCard } from "../contracts/portfolio-advisor.contract.js";
import type { PortfolioReportResult } from "../contracts/portfolio-report.contract.js";

const execFileAsync = promisify(execFile);

const alternateAngles: Record<string, Array<{ brief: string; full: string; idea: string }>> = {
  fan: [{ brief: "Field task: make the value obvious in one glance.", full: "Create a second proof format for the current result: one before/after view, one visible outcome, and one sentence explaining why it matters. Keep it small enough to review in the field.", idea: "Create a one-glance before-and-after proof of the current result." }],
  critic: [{ brief: "Field task: test the riskiest assumption first.", full: "Name the assumption most likely to invalidate the next move, then run one cheap check against current evidence. Record the result and stop if the assumption fails.", idea: "Test the riskiest assumption before spending another work slice." }],
  futurist: [{ brief: "Field task: write the repeatable version of the next win.", full: "Turn the strongest current result into a three-step recipe another person could repeat. Do not expand scope until the recipe works once without special handling.", idea: "Write a three-step repeatable recipe from the strongest current result." }],
  inventor: [{ brief: "Field task: recombine two proven pieces.", full: "Combine two existing pieces of evidence or workflow into one bounded experiment. Change only the combination, preserve the rollback path, and compare it with the current result.", idea: "Combine two proven pieces into one bounded experiment." }],
  publicist: [{ brief: "Field task: name the result before the feature.", full: "Draft a field handoff that starts with the observed result, names who benefits, and gives one next action. Leave implementation detail behind the follow-up step.", idea: "Draft a result-first handoff with one actionable next step." }],
  money: [{ brief: "Field task: set a stop-or-continue threshold.", full: "Choose one measurable result that earns another slice and one result that closes the work for now. Record both before acting so time and leverage stay visible.", idea: "Set one continue threshold and one stop threshold for the next slice." }],
  operations: [{ brief: "Field task: remove one handoff or waiting step.", full: "Trace the next move from start to receipt and remove one avoidable handoff, wait, or context switch. Keep the same proof boundary and record the time saved.", idea: "Remove one avoidable handoff from the next field work slice." }],
  trust: [{ brief: "Field task: verify the boundary before the result leaves the private surface.", full: "Check what data the next move exposes, who can see it, and how to undo it. Capture that boundary beside the result before any sharing or dispatch.", idea: "Verify the data boundary and rollback path before sharing the next result." }],
  design: [{ brief: "Field task: remove one decision from the screen.", full: "Review the next-step screen and remove one competing choice. Put the recommended action, reason, and proof in that order so the operator can act without rereading the whole brief.", idea: "Remove one competing choice from the next-step screen." }],
};

export function generateAdvisorCard(input: PortfolioAdvisorGenerateInput, report: PortfolioReportResult): PortfolioAdvisorGeneratedCard {
  const project = report.project_workspaces.find((item) => item.id === input.project_id);
  const live = report.advisor_reports.find((item) => item.project_id === input.project_id);
  const baseCard = live?.cards.find((card) => card.advisor_id === input.advisor_id);
  if (!project || !live || !baseCard) throw new Error("ADVISOR_GENERATION_PROJECT_NOT_FOUND: refresh the project report before generating another suggestion.");
  if (live.snapshot_id !== input.snapshot_id) throw new Error("ADVISOR_GENERATION_STALE_SNAPSHOT: refresh before asking for another suggestion.");
  if (live.evidence_state_packet.eligible_work_ids.length === 0) throw new Error("ADVISOR_GENERATION_ABSTAINED: no eligible active, blocked, or open work is supported by this snapshot.");
  const eligibleItems = [live.evidence_state_packet.active, live.evidence_state_packet.blocked, live.evidence_state_packet.open]
    .flat()
    .filter((item) => item.advisor_eligible);
  const evidenceAnchor = eligibleItems[0]!;
  const candidates = alternateAngles[input.advisor_id] ?? [{ brief: "Field task: verify one fresh, bounded result.", full: "Use the current project evidence to choose one result that can be checked in this work session. Define the proof and stopping point before acting.", idea: "Verify one fresh bounded result before the next work slice." }];
  const excluded = new Set([input.prior_idea_title, ...input.excluded_titles].map((value) => value.trim().toLowerCase()));
  const baseCandidate = candidates.find((candidate) => !excluded.has(candidate.idea.toLowerCase())) ?? candidates[0];
  const selected = excluded.has(baseCandidate.idea.toLowerCase())
    ? { ...baseCandidate, idea: `${baseCandidate.idea} (alternate ${excluded.size})`, brief: `${baseCandidate.brief} Alternate framing ${excluded.size}.` }
    : baseCandidate;
  const generatedAt = new Date().toISOString();
  const generationKey = `${live.evidence_fingerprint}:${input.advisor_id}:${selected.idea}:${[...excluded].sort().join("|")}`;
  const id = createHash("sha256").update(generationKey).digest("hex").slice(0, 16);
  return {
    project_id: project.id, advisor_id: baseCard.advisor_id, name: baseCard.name, focus: baseCard.focus,
    brief: selected.brief, full: `${selected.full} Current evidence anchor: ${evidenceAnchor.title} (${evidenceAnchor.provenance[0]?.source_path || "recorded project evidence"}).`, idea_title: selected.idea,
    relations: baseCard.relations, snapshot_id: live.snapshot_id, evidence_fingerprint: live.evidence_fingerprint,
    generated_at: generatedAt, generation_source: "evidence_fallback",
    evidence_work_ids: live.evidence_state_packet.eligible_work_ids,
    dispatch_allowed: false,
    translation_boundary: "translation-only: restate eligible packet evidence as useful advice; do not create work, select an owner decision, or dispatch implementation.",
    next_action: `Keep replacement ${id} tied to snapshot ${live.snapshot_id} and refresh before acting if the evidence becomes stale.`,
  };
}

const HermesAdvisorOutcomeSchema = z.object({
  status: z.enum(["card", "abstain"]),
  idea_title: z.string().max(500).default(""),
  quick_take: z.string().max(500).default(""),
  description: z.string().max(5000).default(""),
  evidence_work_ids: z.array(z.string()).max(20).default([]),
  relationships: z.array(z.unknown()).max(20).default([]),
  abstention_reason: z.string().max(1000).nullish().transform((value) => value ?? ""),
});

export type AdvisorModelDispatcher = (prompt: string) => Promise<string>;

const AdvisorIdSchema = z.enum(["fan", "critic", "futurist", "inventor", "publicist", "money", "operations", "trust", "design"]);
const HermesAdvisorBatchOutcomeSchema = z.object({
  advisor_id: AdvisorIdSchema,
  kind: z.enum(["actionable", "perspective", "abstain"]),
  idea_title: z.string().max(500).default(""),
  quick_take: z.string().max(500).default(""),
  description: z.string().max(5000).default(""),
  evidence_work_ids: z.array(z.string()).max(20).default([]),
  relationships: z.array(z.unknown()).max(20).default([]),
  abstention_reason: z.string().max(1000).nullish().transform((value) => value ?? ""),
});
const HermesAdvisorBatchSchema = z.object({
  project_id: z.string(),
  snapshot_id: z.string(),
  outcomes: z.array(HermesAdvisorBatchOutcomeSchema).length(9),
});

type AdvisorReport = PortfolioReportResult["advisor_reports"][number];
type AdvisorCard = AdvisorReport["cards"][number];
type AdvisorBatchCacheEntry = { generatedAt: string; cards: AdvisorCard[] };
const advisorBatchCache = new Map<string, Promise<AdvisorBatchCacheEntry>>();
const ADVISOR_BATCH_CACHE_LIMIT = 50;

export function clearAdvisorBatchCache(): void {
  advisorBatchCache.clear();
}

function stripJsonFence(raw: string): string {
  return raw.replace(/^```json\s*|\s*```$/g, "");
}

function parseAdvisorRelations(value: unknown[], advisorId: string) {
  return value.flatMap((relationship) => {
    const result = z.object({
      advisor_id: AdvisorIdSchema,
      type: z.enum(["supports", "depends_on", "contradicts", "supersedes"]),
      label: z.string().min(1).max(500),
    }).safeParse(relationship);
    return result.success && result.data.advisor_id !== advisorId ? [result.data] : [];
  });
}

function buildHermesAdvisorBatchPrompt(project: PortfolioReportResult["project_workspaces"][number], report: AdvisorReport): string {
  return [
    "Generate one read-only Bridge Field Console Project Advisor batch for all nine advisors in one call.",
    "Use only the supplied evidence packet. Do not inspect files, use tools, dispatch work, or mutate state.",
    "Return JSON only: {project_id,snapshot_id,outcomes:[{advisor_id,kind,idea_title,quick_take,description,evidence_work_ids,relationships,abstention_reason}]}.",
    "Return exactly one outcome for each advisor id: fan, critic, futurist, inventor, publicist, money, operations, trust, design.",
    "kind must be actionable, perspective, or abstain. Actionable means a one-tap bounded work slice and gets YES/NO controls. Perspective changes how Ryan sees the current repo and gets no controls. Abstain when this advisor lacks evidence and gets no controls.",
    "quick_take must be plain language under 18 words. description must explain the evidence, expected outcome, and material tradeoff without jargon.",
    "Never create generic encouragement, status restatement, meditation, vague research, or a question Ryan must answer before the card becomes useful.",
    "Never cite completed, superseded, unknown, owner-dependent, or otherwise ineligible work.",
    "Relationships are optional. If used, each must have advisor_id, type, and label. Use only supports, depends_on, contradicts, or supersedes when actually justified.",
    "Do not calculate or paraphrase evidence age. Cite exact observed dates when time matters.",
    `Project: ${project.name} (${project.id})`,
    `Snapshot: ${report.snapshot_id}`,
    `Advisor definitions: ${JSON.stringify(report.cards.map((card) => ({ advisor_id: card.advisor_id, name: card.name, focus: card.focus })))}`,
    `Eligible work ids: ${JSON.stringify(report.evidence_state_packet.eligible_work_ids)}`,
    `Evidence packet: ${JSON.stringify(report.evidence_state_packet)}`,
  ].join("\n\n");
}

async function generateHermesAdvisorBatch(
  project: PortfolioReportResult["project_workspaces"][number],
  report: AdvisorReport,
  dispatch: AdvisorModelDispatcher,
): Promise<AdvisorBatchCacheEntry> {
  const raw = await dispatch(buildHermesAdvisorBatchPrompt(project, report));
  const parsed = HermesAdvisorBatchSchema.parse(JSON.parse(stripJsonFence(raw)));
  if (parsed.project_id !== project.id || parsed.snapshot_id !== report.snapshot_id) {
    throw new Error("ADVISOR_BATCH_WRONG_SNAPSHOT: model output did not match the requested project snapshot.");
  }
  const expectedIds = report.cards.map((card) => card.advisor_id).sort();
  const actualIds = parsed.outcomes.map((outcome) => outcome.advisor_id).sort();
  if (new Set(actualIds).size !== 9 || JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error("ADVISOR_BATCH_INCOMPLETE: model output did not contain each advisor exactly once.");
  }
  const eligible = new Set(report.evidence_state_packet.eligible_work_ids);
  const generatedAt = new Date().toISOString();
  const cards = parsed.outcomes.map((outcome): AdvisorCard => {
    const base = report.cards.find((card) => card.advisor_id === outcome.advisor_id)!;
    if (outcome.quick_take.trim().split(/\s+/).filter(Boolean).length > 18) {
      throw new Error(`ADVISOR_BATCH_QUICK_TAKE_TOO_LONG: ${outcome.advisor_id}`);
    }
    if (outcome.kind !== "abstain" && (
      outcome.evidence_work_ids.length === 0
      || outcome.evidence_work_ids.some((workId) => !eligible.has(workId))
    )) {
      throw new Error(`ADVISOR_BATCH_INVALID_EVIDENCE: ${outcome.advisor_id}`);
    }
    if (outcome.kind === "abstain" && outcome.evidence_work_ids.some((workId) => !eligible.has(workId))) {
      throw new Error(`ADVISOR_BATCH_INVALID_EVIDENCE: ${outcome.advisor_id}`);
    }
    const abstention = outcome.abstention_reason || "This advisor has no evidence-backed recommendation for the current snapshot.";
    return {
      advisor_id: base.advisor_id,
      name: base.name,
      focus: base.focus,
      brief: outcome.kind === "abstain" ? (outcome.quick_take || "No evidence-backed recommendation") : outcome.quick_take,
      full: outcome.kind === "abstain" ? abstention : outcome.description,
      idea_title: outcome.kind === "abstain" ? `No current recommendation from ${base.name}` : outcome.idea_title,
      kind: outcome.kind,
      control_mode: outcome.kind === "actionable" ? "yes_no" : "none",
      evidence_work_ids: outcome.evidence_work_ids,
      relations: parseAdvisorRelations(outcome.relationships, outcome.advisor_id),
    };
  });
  return { generatedAt, cards };
}

export async function hydrateAdvisorBatchForProject(
  report: PortfolioReportResult,
  projectId: string,
  dispatch: AdvisorModelDispatcher = dispatchHermesAdvisor,
): Promise<PortfolioReportResult> {
  const target = report.advisor_reports.find((item) => item.project_id === projectId);
  const project = report.project_workspaces.find((item) => item.id === projectId);
  if (!target || !project) return report;
  if (target.evidence_state_packet.eligible_work_ids.length === 0) {
    return {
      ...report,
      advisor_reports: report.advisor_reports.map((item) => item.project_id === projectId
        ? { ...item, advisor_generation_status: "abstained", advisor_generation_detail: "No eligible active, blocked, or open work supports advisor generation." }
        : item),
    };
  }
  const cacheKey = target.snapshot_id;
  const cached = advisorBatchCache.has(cacheKey);
  let pending = advisorBatchCache.get(cacheKey);
  if (!pending) {
    pending = generateHermesAdvisorBatch(project, target, dispatch);
    advisorBatchCache.set(cacheKey, pending);
    if (advisorBatchCache.size > ADVISOR_BATCH_CACHE_LIMIT) {
      const oldest = advisorBatchCache.keys().next().value;
      if (oldest) advisorBatchCache.delete(oldest);
    }
  }
  try {
    const batch = await pending;
    return {
      ...report,
      advisor_reports: report.advisor_reports.map((item) => item.project_id === projectId
        ? {
          ...item,
          generated_at: batch.generatedAt,
          advisor_generation_source: "model",
          advisor_generation_status: cached ? "cached" : "generated",
          advisor_generation_detail: cached
            ? "Reused the GPT-5.4 High batch for this unchanged snapshot."
            : "Generated all nine advisors in one GPT-5.4 High call for this snapshot.",
          cards: batch.cards,
        }
        : item),
    };
  } catch {
    advisorBatchCache.delete(cacheKey);
    return {
      ...report,
      advisor_reports: report.advisor_reports.map((item) => item.project_id === projectId
        ? {
          ...item,
          advisor_generation_source: "evidence_fallback",
          advisor_generation_status: "fallback",
          advisor_generation_detail: "Hermes generation was unavailable or invalid; deterministic evidence fallback retained.",
        }
        : item),
    };
  }
}

function advisorGenerationContext(input: PortfolioAdvisorGenerateInput, report: PortfolioReportResult) {
  const project = report.project_workspaces.find((item) => item.id === input.project_id);
  const live = report.advisor_reports.find((item) => item.project_id === input.project_id);
  const baseCard = live?.cards.find((card) => card.advisor_id === input.advisor_id);
  if (!project || !live || !baseCard) throw new Error("ADVISOR_GENERATION_PROJECT_NOT_FOUND: refresh the project report before generating another suggestion.");
  if (live.snapshot_id !== input.snapshot_id) throw new Error("ADVISOR_GENERATION_STALE_SNAPSHOT: refresh before asking for another suggestion.");
  if (live.evidence_state_packet.eligible_work_ids.length === 0) throw new Error("ADVISOR_GENERATION_ABSTAINED: no eligible active, blocked, or open work is supported by this snapshot.");
  return { project, live, baseCard };
}

function buildHermesAdvisorPrompt(
  input: PortfolioAdvisorGenerateInput,
  context: ReturnType<typeof advisorGenerationContext>,
) {
  const { project, live, baseCard } = context;
  const decisionRule = input.decision === "declined"
    ? "The prior card was declined. Produce a materially different angle, not a rewrite or synonym."
    : "The prior card was accepted. Produce only a compatible refinement or next step; do not compete with the accepted work.";
  return [
    "Generate one read-only Bridge Field Console Project Advisor replacement.",
    "Use only the supplied evidence packet. Do not inspect files, use tools, dispatch work, or mutate state.",
    "Return JSON only with keys: status, idea_title, quick_take, description, evidence_work_ids, relationships, abstention_reason.",
    "status must be card or abstain. If card, quick_take must be plain language under 18 words and the description must define a bounded one-tap work slice or a genuinely useful perspective.",
    "If no evidence-backed contribution exists for this advisor, return status abstain instead of filler.",
    "Never cite completed, superseded, unknown, owner-dependent, or otherwise ineligible work.",
    "Relationships are optional. If used, each relationship must have advisor_id, type, and label. Do not put work_id relationships here.",
    "Do not calculate or paraphrase evidence age. Cite exact observed dates when time matters.",
    decisionRule,
    `Project: ${project.name} (${project.id})`,
    `Snapshot: ${live.snapshot_id}`,
    `Advisor: ${baseCard.name} (${baseCard.advisor_id})`,
    `Advisor focus: ${baseCard.focus}`,
    `Prior idea: ${input.prior_idea_title}`,
    `Retired or excluded titles: ${JSON.stringify(input.excluded_titles)}`,
    `Eligible work ids: ${JSON.stringify(live.evidence_state_packet.eligible_work_ids)}`,
    `Evidence packet: ${JSON.stringify(live.evidence_state_packet)}`,
  ].join("\n\n");
}

export async function dispatchHermesAdvisor(prompt: string): Promise<string> {
  const script = process.env.HERMES_ADVISOR_DISPATCH_SCRIPT?.trim();
  if (!script) throw new Error("HERMES_ADVISOR_UNAVAILABLE: HERMES_ADVISOR_DISPATCH_SCRIPT is not configured.");
  const pwsh = process.env.HERMES_PWSH_COMMAND?.trim() || "pwsh.exe";
  const { stdout } = await execFileAsync(pwsh, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-File", script,
    "-Prompt", prompt,
    "-Profile", "projectadvisors",
    "-Provider", "openai-codex",
    "-Model", "gpt-5.4",
    "-ModelLane", "advisor_generation_high",
  ], { timeout: 180_000, maxBuffer: 5 * 1024 * 1024, windowsHide: true });
  const receipt = z.object({
    status: z.literal("completed"),
    route: z.object({
      profile: z.literal("projectadvisors"),
      provider: z.literal("openai-codex"),
      model: z.literal("gpt-5.4"),
      modelLane: z.literal("advisor_generation_high"),
    }),
    output: z.string(),
  }).parse(JSON.parse(stdout));
  return receipt.output;
}

export async function generateAdvisorCardWithHermes(
  input: PortfolioAdvisorGenerateInput,
  report: PortfolioReportResult,
  dispatch: AdvisorModelDispatcher = dispatchHermesAdvisor,
): Promise<PortfolioAdvisorGeneratedCard> {
  const context = advisorGenerationContext(input, report);
  const raw = await dispatch(buildHermesAdvisorPrompt(input, context));
  const parsed = HermesAdvisorOutcomeSchema.parse(JSON.parse(stripJsonFence(raw)));
  if (parsed.status === "abstain") {
    throw new Error(`ADVISOR_GENERATION_ABSTAINED: ${parsed.abstention_reason || "this advisor has no evidence-backed replacement."}`);
  }
  const eligible = new Set(context.live.evidence_state_packet.eligible_work_ids);
  if (parsed.evidence_work_ids.length === 0 || parsed.evidence_work_ids.some((workId) => !eligible.has(workId))) {
    throw new Error("ADVISOR_GENERATION_INVALID_EVIDENCE: model output cited missing or ineligible work.");
  }
  const relations = parseAdvisorRelations(parsed.relationships, context.baseCard.advisor_id);
  const generatedAt = new Date().toISOString();
  return {
    project_id: context.project.id,
    advisor_id: context.baseCard.advisor_id,
    name: context.baseCard.name,
    focus: context.baseCard.focus,
    brief: parsed.quick_take,
    full: parsed.description,
    idea_title: parsed.idea_title,
    relations,
    snapshot_id: context.live.snapshot_id,
    evidence_fingerprint: context.live.evidence_fingerprint,
    generated_at: generatedAt,
    generation_source: "model",
    evidence_work_ids: parsed.evidence_work_ids,
    dispatch_allowed: false,
    translation_boundary: "Hermes GPT-5.4 High advisory generation only; no repository inspection, mutation, or work dispatch.",
    next_action: `Keep this replacement tied to snapshot ${context.live.snapshot_id}; refresh before acting if project evidence changes.`,
  };
}
