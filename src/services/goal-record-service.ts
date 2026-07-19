import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GoalCommand, GoalRecord } from "../contracts/goal-record.contract.js";
import type { GoalReviewDecision, PortfolioExecutionReceipt, PortfolioExecutionRequest } from "../contracts/portfolio-action.contract.js";
import type { HermesWatchResult } from "../contracts/hermes-supervision.contract.js";

type Store = { version: 1; updated_at: string; goals: GoalRecord[] };

export class GoalRecordService {
  private static queues = new Map<string, Promise<void>>();
  private readonly path: string;
  constructor(repoRoot: string, private readonly now: () => Date = () => new Date()) {
    this.path = join(repoRoot, ".chatgpt", "goal-records-v1.json");
  }

  async read(): Promise<GoalRecord[]> {
    try { return ((JSON.parse(await readFile(this.path, "utf8")) as Store).goals ?? []).map(normalize); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }

  goalId(key: string): string { return `goal-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`; }

  async findIdempotent(key: string): Promise<GoalRecord | undefined> {
    return (await this.read()).find((goal) => goal.idempotency_key === key);
  }

  async upsert(command: GoalCommand): Promise<GoalRecord> {
    return this.lock(async () => {
      const goals = await this.read();
      const now = this.now().toISOString();
      const id = command.goal_id || this.goalId(command.idempotency_key);
      const previous = goals.find((goal) => goal.goal_id === id || goal.idempotency_key === command.idempotency_key);
      const state = command.state ?? previous?.state ?? (command.executor === "codex" ? "working" : "planned");
      const record: GoalRecord = normalize({
        ...(previous ?? {}), version: 1, goal_id: previous?.goal_id ?? id, idempotency_key: command.idempotency_key,
        project_id: command.project_id, project_name: command.project_name ?? previous?.project_name ?? command.project_id,
        repository_id: command.repository_id, action_id: command.action_id ?? previous?.action_id ?? "", objective: command.objective,
        source_kind: command.source_kind, source_reference: command.source_reference ?? previous?.source_reference ?? "",
        plan: command.plan ?? previous?.plan ?? [], dependencies: command.dependencies ?? previous?.dependencies ?? [],
        parallel_wave: command.parallel_wave ?? previous?.parallel_wave ?? 0, serial_after: command.serial_after ?? previous?.serial_after ?? [],
        executor: command.executor, routing_reason: command.routing_reason, execution_scope: command.execution_scope ?? previous?.execution_scope ?? [],
        privacy_scope: command.privacy_scope, proof_boundary: command.proof_boundary,
        hermes_transaction: previous?.hermes_transaction ?? "", hermes_board: previous?.hermes_board ?? "", hermes_task: previous?.hermes_task ?? "", hermes_cursor: previous?.hermes_cursor ?? "",
        codex_arbiter: command.codex_arbiter ?? previous?.codex_arbiter ?? "Codex", satisfaction_threshold: command.satisfaction_threshold,
        satisfaction_score: command.satisfaction_score ?? previous?.satisfaction_score ?? 0, iteration: command.iteration ?? previous?.iteration ?? 0,
        unmet_dimensions: command.unmet_dimensions ?? previous?.unmet_dimensions ?? [], evidence: command.evidence ?? previous?.evidence ?? [],
        artifacts: command.artifacts ?? previous?.artifacts ?? [], changed_files: command.changed_files ?? previous?.changed_files ?? [], state,
        provisional_completion: state === "provisional", final_acceptance: state === "accepted",
        cancellation_reason: command.cancellation_reason ?? previous?.cancellation_reason ?? "", intervention: command.intervention ?? previous?.intervention ?? "",
        retry_count: previous?.retry_count ?? 0, created_at: previous?.created_at ?? now, updated_at: now,
        heartbeat_at: command.heartbeat_at ?? now, terminal_at: terminal(state) ? (previous?.terminal_at || now) : "",
        events: [...(previous?.events ?? []), event(now, command.executor, state, previous ? `Goal updated: ${state}.` : `Goal registered: ${state}.`)].slice(-250)
      });
      const next = goals.filter((goal) => goal.goal_id !== record.goal_id && goal.idempotency_key !== record.idempotency_key);
      next.push(record); await this.write(next); return record;
    });
  }

  async recordLaunch(command: GoalCommand, receipt: PortfolioExecutionReceipt): Promise<GoalRecord> {
    const record = await this.upsert({ ...command, goal_id: receipt.goal_id, state: receipt.ok ? (receipt.status === "accepted" ? "accepted" : "working") : "blocked" });
    return this.lock(async () => {
      const goals = await this.read(); const now = this.now().toISOString();
      const updated = normalize({ ...record, hermes_transaction: receipt.transaction_id, hermes_board: receipt.board, hermes_task: receipt.task_id,
        satisfaction_threshold: receipt.satisfaction_gate, updated_at: now, heartbeat_at: now,
        events: [...record.events, event(now, "hermes", receipt.status, receipt.operator_status)].slice(-250) });
      await this.write([...goals.filter((goal) => goal.goal_id !== updated.goal_id), updated]); return updated;
    });
  }

  async recordReviewDecision(command: GoalCommand, review: GoalReviewDecision): Promise<GoalRecord> {
    return this.lock(async () => {
      const goals = await this.read();
      const now = this.now().toISOString();
      const id = command.goal_id || this.goalId(command.idempotency_key);
      const previous = goals.find((goal) => goal.goal_id === id || goal.idempotency_key === command.idempotency_key);
      const nextState: GoalRecord["state"] = "reviewing";
      const summary = review.decision === "yes"
        ? "Field Console YES: operator approved continuing this review item."
        : "Field Console NO: operator rejected this review item and requested a smaller replacement.";
      const record: GoalRecord = normalize({
        ...(previous ?? {}), version: 1, goal_id: previous?.goal_id ?? id, idempotency_key: command.idempotency_key,
        project_id: command.project_id, project_name: command.project_name ?? previous?.project_name ?? command.project_id,
        repository_id: command.repository_id, action_id: command.action_id ?? previous?.action_id ?? "", objective: command.objective,
        source_kind: command.source_kind, source_reference: command.source_reference ?? previous?.source_reference ?? "",
        plan: command.plan ?? previous?.plan ?? [], dependencies: command.dependencies ?? previous?.dependencies ?? [],
        parallel_wave: command.parallel_wave ?? previous?.parallel_wave ?? 0, serial_after: command.serial_after ?? previous?.serial_after ?? [],
        executor: command.executor, routing_reason: command.routing_reason, execution_scope: command.execution_scope ?? previous?.execution_scope ?? [],
        privacy_scope: command.privacy_scope, proof_boundary: command.proof_boundary,
        hermes_transaction: previous?.hermes_transaction ?? "", hermes_board: previous?.hermes_board ?? "", hermes_task: previous?.hermes_task ?? "", hermes_cursor: previous?.hermes_cursor ?? "",
        codex_arbiter: command.codex_arbiter ?? previous?.codex_arbiter ?? "Codex", satisfaction_threshold: command.satisfaction_threshold,
        satisfaction_score: command.satisfaction_score ?? previous?.satisfaction_score ?? 0, iteration: command.iteration ?? previous?.iteration ?? 0,
        unmet_dimensions: command.unmet_dimensions ?? previous?.unmet_dimensions ?? [], evidence: command.evidence ?? previous?.evidence ?? [],
        artifacts: command.artifacts ?? previous?.artifacts ?? [], changed_files: command.changed_files ?? previous?.changed_files ?? [],
        state: nextState, provisional_completion: true, final_acceptance: false,
        cancellation_reason: command.cancellation_reason ?? previous?.cancellation_reason ?? "",
        intervention: review.instruction, retry_count: (previous?.retry_count ?? 0) + 1,
        created_at: previous?.created_at ?? now, updated_at: now, heartbeat_at: command.heartbeat_at ?? now, terminal_at: "",
        events: [...(previous?.events ?? []), event(now, "operator", `field_review_${review.decision}`, summary)].slice(-250)
      });
      const next = goals.filter((goal) => goal.goal_id !== record.goal_id && goal.idempotency_key !== record.idempotency_key);
      next.push(record); await this.write(next); return record;
    });
  }

  async reconcileHermes(watch: HermesWatchResult): Promise<GoalRecord | undefined> {
    if (!watch.hermes_transaction) return undefined;
    return this.lock(async () => {
      const goals = await this.read();
      const previous = goals.find((goal) => goal.hermes_transaction === watch.hermes_transaction);
      if (!previous) return undefined;
      const state: GoalRecord["state"] = watch.state === "accepted" ? "accepted"
        : watch.state === "proof_check" ? "reviewing"
          : watch.state === "blocked" ? "blocked"
            : watch.state === "stopped" ? "cancelled"
              : watch.state === "unavailable" ? "stale" : "working";
      const seen = new Set(previous.events.map((item) => item.cursor));
      const newEvents: GoalRecord["events"] = watch.events.filter((item) => !seen.has(item.cursor)).map((item) => ({
        event_id: randomUUID(), cursor: item.cursor, observed_at: item.observed_at, event_type: item.event_type,
        source: item.source === "codex" || item.source === "hermes" || item.source === "operator" ? item.source : "bridge",
        summary: item.summary
      }));
      const updated = normalize({ ...previous, state, hermes_cursor: watch.next_cursor || previous.hermes_cursor,
        satisfaction_score: state === "accepted" ? 100 : previous.satisfaction_score,
        provisional_completion: state === "reviewing", final_acceptance: state === "accepted",
        unmet_dimensions: state === "blocked" || state === "stale" ? watch.warnings : previous.unmet_dimensions,
        updated_at: watch.observed_at, heartbeat_at: watch.observed_at, terminal_at: terminal(state) ? watch.observed_at : "",
        events: [...previous.events, ...newEvents].slice(-250) });
      await this.write([...goals.filter((goal) => goal.goal_id !== updated.goal_id), updated]);
      return updated;
    });
  }

  fromExecution(input: { repo_id: string; action_id: string; execution: PortfolioExecutionRequest }): GoalCommand {
    const e = input.execution; const key = e.idempotency_key || `${input.repo_id}:${input.action_id}:${e.objective}`;
    return { idempotency_key: key, project_id: e.project_id || input.action_id, project_name: e.project_name || e.project_id || input.action_id,
      repository_id: e.target_repo_id, action_id: input.action_id, objective: e.objective, source_kind: e.source_kind ?? "field_console",
      source_reference: e.source_reference, plan: e.plan, dependencies: e.dependencies, parallel_wave: e.parallel_wave, serial_after: e.serial_after,
      executor: e.executor ?? "hermes", routing_reason: e.routing_reason ?? "Bounded work routed through the existing Hermes execution protocol.", execution_scope: e.allowed_paths, privacy_scope: e.privacy_scope ?? "private_local",
      proof_boundary: e.proof_boundary, satisfaction_threshold: e.satisfaction_gate, codex_arbiter: "Codex" };
  }

  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    const prior = GoalRecordService.queues.get(this.path) ?? Promise.resolve(); let release = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; }); GoalRecordService.queues.set(this.path, prior.then(() => current)); await prior;
    try { return await fn(); } finally { release(); }
  }
  private async write(goals: GoalRecord[]) { const now = this.now().toISOString(); await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify({ version: 1, updated_at: now, goals }, null, 2)}\n`); await rename(temp, this.path); }
}

function normalize(value: Partial<GoalRecord>): GoalRecord {
  return { version: 1, goal_id: value.goal_id ?? "", idempotency_key: value.idempotency_key ?? "", project_id: value.project_id ?? "", project_name: value.project_name ?? "",
    repository_id: value.repository_id ?? "", action_id: value.action_id ?? "", objective: value.objective ?? "", source_kind: value.source_kind ?? "bridge", source_reference: value.source_reference ?? "",
    plan: value.plan ?? [], dependencies: value.dependencies ?? [], parallel_wave: value.parallel_wave ?? 0, serial_after: value.serial_after ?? [], executor: value.executor ?? "hermes",
    routing_reason: value.routing_reason ?? "", execution_scope: value.execution_scope ?? [], privacy_scope: value.privacy_scope ?? "private_local", proof_boundary: value.proof_boundary ?? "",
    hermes_transaction: value.hermes_transaction ?? "", hermes_board: value.hermes_board ?? "", hermes_task: value.hermes_task ?? "", hermes_cursor: value.hermes_cursor ?? "",
    codex_arbiter: value.codex_arbiter ?? "Codex", satisfaction_threshold: value.satisfaction_threshold ?? 95, satisfaction_score: value.satisfaction_score ?? 0, iteration: value.iteration ?? 0,
    unmet_dimensions: value.unmet_dimensions ?? [], evidence: value.evidence ?? [], artifacts: value.artifacts ?? [], changed_files: value.changed_files ?? [], state: value.state ?? "planned",
    provisional_completion: value.provisional_completion ?? false, final_acceptance: value.final_acceptance ?? false, cancellation_reason: value.cancellation_reason ?? "", intervention: value.intervention ?? "",
    retry_count: value.retry_count ?? 0, created_at: value.created_at ?? "", updated_at: value.updated_at ?? "", heartbeat_at: value.heartbeat_at ?? "", terminal_at: value.terminal_at ?? "", events: value.events ?? [] };
}
function terminal(state: GoalRecord["state"]) { return ["accepted", "cancelled", "archived", "failed"].includes(state); }
function event(at: string, source: string, type: string, summary: string): GoalRecord["events"][number] {
  const eventSource: GoalRecord["events"][number]["source"] = source === "hermes" || source === "local" || source === "codex" || source === "operator" ? source : "bridge";
  return { event_id: randomUUID(), cursor: `${at}:${randomUUID()}`, observed_at: at, event_type: type, source: eventSource, summary };
}
