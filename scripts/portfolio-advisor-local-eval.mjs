import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildPortfolioAdvisorEvidenceStatePacket } from "../src/services/portfolio-advisor-state-service.ts";

const [repoArg, outputArg] = process.argv.slice(2);
if (!repoArg || !outputArg) {
  console.error("usage: node --import tsx scripts/portfolio-advisor-local-eval.mjs <lead-and-follow-repo> <output-json>");
  process.exit(2);
}

const repo = resolve(repoArg);
const outputPath = resolve(outputArg);
const apiBase = process.env.OLLAMA_HOST || "http://172.19.0.1:11434";
const numCtx = Number(process.env.ADVISOR_EVAL_NUM_CTX || 16384);
const numPredict = Number(process.env.ADVISOR_EVAL_NUM_PREDICT || 4096);
const models = (process.env.ADVISOR_EVAL_MODELS || "batiai/qwen3.6-27b:iq4,glm-4.7-flash:Q4_K_M").split(",").map((value) => value.trim()).filter(Boolean);
const observedAt = new Date().toISOString();

const sources = {
  onboarding: "docs/PROJECT_ONBOARDING.md",
  current: "docs/CURRENT_STATE.md",
  runtime: "docs/RUNTIME_INVENTORY.md",
  result: "docs/council/day1-reception-runtime-authored-pass-RESULT.md",
};
const sourceText = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([key, relativePath]) => [key, await readFile(resolve(repo, relativePath), "utf8")])));
requireEvidence(sourceText.onboarding, "Prototype slice", sources.onboarding);
requireEvidence(sourceText.current, "old lesson backdrop is now hidden", sources.current);
requireEvidence(sourceText.current, "remaining blockers to 95%", sources.current);
requireEvidence(sourceText.current, "future partnering needs actual arm/body contact", sources.current);
requireEvidence(sourceText.current, "Which Krea source frames become locked art seeds", sources.current);
requireEvidence(sourceText.result, "npm run check` — PASS", sources.result);

const gitHead = git(repo, ["rev-parse", "HEAD"]).trim();
const gitStatus = git(repo, ["status", "--porcelain=v2"]);
const sourceGeneratedAt = observedAt;
const packet = buildPortfolioAdvisorEvidenceStatePacket({
  project: {
    id: "lead-and-follow", name: "Lead and Follow", status: "active", phase: "prototype slice",
    product_track: "phone-served Godot Web prologue and dance-learning interaction", confidence: "high",
    summary: "Phone-first Godot Day 1 prologue and Waltz lesson checkpoint.",
  },
  sourceGeneratedAt,
  roadmap: [],
  recentResults: [
    result("Day 1 reception runtime authored pass completed and verified with checks, tests, Godot import/export, and phone-flow audits.", "2026-07-07", sources.result),
    result("Superseded presentation work: the old lesson backdrop is hidden in active lesson mode.", "2026-07-07", sources.current),
    result("Active prototype slice: phone-serving the first Godot prologue and dance checkpoint.", "2026-07-07", sources.onboarding),
    result("Blocked quality gap: character appeal, embodied partner chemistry, and partner mechanics remain below the 95% bar.", "2026-07-07", sources.current),
    result("Open next slice: replace abstract partnering with actual arm/body contact, knee action, and later ankle/foot articulation.", "2026-07-07", sources.current),
    result("Unknown temporal state: current dirty runtime and evidence changes are newer than the last project-state update and require verification before claims.", observedAt, "git status --porcelain=v2"),
    result("Open owner-dependent decision: Ask Ryan to choose which Krea source frames become locked art seeds.", "2026-07-07", sources.current),
  ],
  suggestedNextMoves: [], ledgerEntries: [], goals: [], ideas: [],
});

const snapshot = {
  snapshot_id: `lead-and-follow:${gitHead}:${sha256(gitStatus).slice(0, 16)}:${observedAt}`,
  observed_at: observedAt,
  repository: repo,
  git_head: gitHead,
  git_status_sha256: sha256(gitStatus),
  git_status_entry_count: gitStatus.split("\n").filter(Boolean).length,
  source_files: await Promise.all(Object.values(sources).map(async (relativePath) => {
    const content = await readFile(resolve(repo, relativePath));
    const metadata = await stat(resolve(repo, relativePath));
    return { path: relativePath, sha256: sha256(content), modified_at: metadata.mtime.toISOString() };
  })),
  evidence_state_packet: packet,
};

const modelResults = [];
for (const model of models) {
  const startedAt = new Date().toISOString();
  const response = await fetch(`${apiBase}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      think: false,
      keep_alive: 0,
      options: { num_ctx: numCtx, num_predict: numPredict, temperature: 0.2, seed: 42 },
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: JSON.stringify({ snapshot_id: snapshot.snapshot_id, packet }, null, 2) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`${model} returned HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json();
  const raw = body.message?.content || "";
  const parsed = parseJson(raw);
  const testedCards = gateCards(parsed.cards, packet);
  modelResults.push({
    model,
    api: `${apiBase}/api/chat`,
    settings: { num_ctx: numCtx, num_predict: numPredict, temperature: 0.2, seed: 42, format: "json", think: false, stream: false, keep_alive: 0 },
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    prompt_eval_count: body.prompt_eval_count ?? null,
    eval_count: body.eval_count ?? null,
    total_duration_ns: body.total_duration ?? null,
    raw_response: raw,
    cards: testedCards,
    accepted_count: testedCards.filter((card) => card.gate_decision === "accept").length,
    rejected_count: testedCards.filter((card) => card.gate_decision === "reject").length,
  });
}

const evaluation = {
  status: "completed",
  runner: "Hermes direct bounded execution",
  read_only: true,
  snapshot,
  exact_model_context_settings: modelResults.map(({ model, settings }) => ({ model, ...settings })),
  models: modelResults,
  recommended_boundary: "Local models may translate explicitly eligible active, blocked, or open packet evidence into compact project-specific advisor wording. They must not classify source evidence, invent paths or facts, revive completed/superseded work, choose owner-dependent decisions, create generic process tasks, dispatch work, or mutate state. Deterministic bridge code remains the classifier and gate; abstention is valid.",
};
await writeFile(outputPath, JSON.stringify(evaluation, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ status: evaluation.status, output: outputPath, snapshot_id: snapshot.snapshot_id, packet_counts: packet.counts, models: modelResults.map((item) => ({ model: item.model, accepted: item.accepted_count, rejected: item.rejected_count })) }, null, 2));

function result(summary, date, source) {
  return { project_id: "lead-and-follow", project_name: "Lead and Follow", date, summary, source };
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}

function requireEvidence(content, needle, source) {
  if (!content.includes(needle)) throw new Error(`fresh snapshot evidence missing from ${source}: ${needle}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(value) {
  try { return JSON.parse(value); } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`model did not return JSON: ${value.slice(0, 500)}`);
    return JSON.parse(match[0]);
  }
}

function systemPrompt() {
  return `You are a read-only Project Advisors translation test. Return one JSON object with a "cards" array containing exactly one card for each advisor_id: fan, critic, futurist, inventor, publicist, money, operations, trust, design.
Each card must contain advisor_id, model_decision (accept or reject), reason, evidence_work_ids (array), and advice.
Use only work IDs listed in eligible_work_ids. Never recommend completed, superseded, unknown, owner-dependent, or generic process work. Never invent a file path, runtime claim, completion claim, owner choice, or capability. Never dispatch or describe dispatch. Preserve meaningful advisor differences. Advice must be a specific translation of cited eligible evidence, not a new task. If the evidence cannot support that advisor, reject with an honest reason and empty advice. JSON only.`;
}

function gateCards(cards, evidencePacket) {
  const advisorIds = ["fan", "critic", "futurist", "inventor", "publicist", "money", "operations", "trust", "design"];
  const eligible = new Set(evidencePacket.eligible_work_ids);
  const eligibleItems = new Map([evidencePacket.active, evidencePacket.blocked, evidencePacket.open]
    .flat().filter((item) => item.advisor_eligible).map((item) => [item.work_id, item]));
  const terminalText = [...evidencePacket.completed, ...evidencePacket.superseded, ...evidencePacket.unknown].map((item) => item.title.toLowerCase());
  const seenAdvice = new Set();
  return advisorIds.map((advisorId) => {
    const matches = Array.isArray(cards) ? cards.filter((card) => card?.advisor_id === advisorId) : [];
    const card = matches[0] || { advisor_id: advisorId, model_decision: "reject", reason: "Model omitted this required advisor.", evidence_work_ids: [], advice: "" };
    const ids = Array.isArray(card.evidence_work_ids) ? card.evidence_work_ids : [];
    const advice = typeof card.advice === "string" ? card.advice.trim() : "";
    const normalizedAdvice = advice.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const citedItems = ids.map((id) => eligibleItems.get(id)).filter(Boolean);
    const rejectReasons = [];
    if (matches.length !== 1) rejectReasons.push(matches.length ? "duplicate advisor card" : "missing advisor card");
    if (!['accept', 'reject'].includes(card.model_decision)) rejectReasons.push("invalid model decision");
    if (card.model_decision === "accept" && (!ids.length || ids.some((id) => !eligible.has(id)))) rejectReasons.push("acceptance lacks only eligible evidence work IDs");
    if (card.model_decision === "accept" && advice.length < 40) rejectReasons.push("accepted advice is too thin to be useful");
    if (/\b(ask ryan|ask the (user|owner|operator)|wait for (ryan|the user|the owner)|dispatch|launch a worker|create a task)\b/i.test(advice)) rejectReasons.push("owner-dependent or dispatch work");
    if (/^(review|improve|continue|plan|document) (the )?(project|process|work|next steps?)/i.test(advice)) rejectReasons.push("generic process filler");
    if (terminalText.some((title) => title.length > 20 && advice.toLowerCase().includes(title))) rejectReasons.push("repeats terminal or unknown work");
    const citedText = citedItems.flatMap((item) => [item.title, item.detail, ...item.provenance.map((source) => source.detail)]).join(" ").toLowerCase();
    const evidenceWords = new Set(significantWords(citedText));
    const overlap = new Set(significantWords(advice).filter((word) => evidenceWords.has(word))).size;
    if (card.model_decision === "accept" && overlap < 3) rejectReasons.push("claim is not specifically anchored in cited evidence");
    const pathClaims = advice.match(/\b(?:[a-z0-9_.-]+\/)+[a-z0-9_.-]+\.[a-z0-9]{1,8}\b/gi) ?? [];
    const allowedPaths = citedItems.flatMap((item) => item.provenance.map((source) => source.source_path));
    if (pathClaims.some((claim) => !allowedPaths.some((path) => path.includes(claim)))) rejectReasons.push("invented path");
    if (/\b(completed?|finished|shipped|released|verified|success(?:ful|fully))\b/i.test(advice)
      && !/\b(completed?|finished|shipped|released|verified|success(?:ful|fully))\b/i.test(citedText)) rejectReasons.push("invented completion claim");
    if (advisorId === "money" && !/\b(cost|budget|price|revenue|profit|financial|market|resource allocation|efficient)\b/i.test(citedText)) rejectReasons.push("cited evidence has no financial or resource basis");
    if (advisorId === "trust" && !/\b(privacy|security|safety|accessibility|trust|ethic|reputation|data integrity)\b/i.test(citedText)) rejectReasons.push("cited evidence has no trust or safety basis");
    if (normalizedAdvice && seenAdvice.has(normalizedAdvice)) rejectReasons.push("duplicate advice");
    if (normalizedAdvice) seenAdvice.add(normalizedAdvice);
    if (card.model_decision === "reject" && !(typeof card.reason === "string" && card.reason.trim())) rejectReasons.push("abstention has no reason");
    const accepted = card.model_decision === "accept" && rejectReasons.length === 0;
    return {
      advisor_id: advisorId,
      model_decision: card.model_decision,
      model_reason: typeof card.reason === "string" ? card.reason : "",
      evidence_work_ids: ids,
      advice,
      gate_decision: accepted ? "accept" : "reject",
      gate_reason: accepted ? `Accepted: specific translation tied only to eligible evidence (${ids.join(", ")}).` : `Rejected: ${rejectReasons.join("; ") || card.reason || "model abstained"}.`,
    };
  });
}

function significantWords(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((word) => word.length > 3 && !["this", "that", "with", "from", "into", "work", "next", "current", "project"].includes(word));
}
