import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRunnerStatusInput, AgentRunnerStatusResult, RunLiveTailInput, RunLiveTailResult } from "../contracts/agent-runner.contract.js";
import { getConnectorDiagnostics } from "../runtime/connector-session.js";
import { buildConnectorIdentitySnapshot } from "../runtime/connector-identity.js";

const ACTIVE_HEARTBEAT_STATUSES = new Set(["starting", "polling", "running", "completed_run"]);
const EVENT_LOG_PATH = ".chatgpt/events/bridge-events.jsonl";
const EVENT_RETENTION_LIMIT = 500;
const MAX_POLL_COUNT = 4;
const MIN_POLL_INTERVAL_SECONDS = 5;
const MAX_POLL_INTERVAL_SECONDS = 15;
const DEFAULT_POLL_INTERVAL_SECONDS = 10;

type ClassifiedRun = {
  run_id: string;
  state: "pending" | "active_locked" | "stale_locked" | "completed" | "completed_with_lock_warning" | "blocked";
  lock_path?: string;
  lock_age_seconds?: number;
  runner_pid?: number | null;
  child_pid?: number | null;
  worker_slot_id?: number | null;
  pid_status?: "alive" | "dead" | "missing" | "unknown" | "";
  stale_reason?: "dead_pid" | "lock_age_exceeded" | "";
  suggested_next_action?: string;
  result_md_exists?: boolean;
  run_dir_recent_mtime_ms?: number | null;
  result_path?: string;
  result_mtime_ms?: number;
  result_status?: string;
};

type LiveTailEvent = AgentRunnerStatusResult["active_run_live_tail"][number];
type PollHistoryEntry = AgentRunnerStatusResult["poll_history"][number];
type WorkerSlot = AgentRunnerStatusResult["worker_slots"][number];
type MonitoringStopReason = AgentRunnerStatusResult["monitoring_stop_reason"];
type StatusSnapshot = Omit<AgentRunnerStatusResult, "poll_count" | "poll_interval_seconds" | "monitoring_stop_reason" | "poll_history">;
type StatusServiceOptions = {
  sleep?: (milliseconds: number) => Promise<void>;
};

type BridgeEvent = {
  event_id: string;
  event_type:
    | "run_created"
    | "run_claimed"
    | "run_completed"
    | "run_blocked"
    | "run_failed"
    | "run_timed_out"
    | "stale_lock_detected"
    | "stale_lock_recovered"
    | "runner_stale"
    | "runner_recovered"
    | "capability_changed"
    | "queue_backlog_detected"
    | "auth_missing"
    | "auth_denied"
    | "auth_allowed"
    | "public_safe_status_served"
    | "sensitive_status_redacted"
    | "privileged_action_denied"
    | "privileged_action_allowed"
    | "connector_session_terminated"
    | "connector_session_recovered"
    | "connector_schema_changed"
    | "connector_cache_suspected_stale"
    | "path_token_connector_auth_enabled";
  repo_id: string;
  run_id: string;
  result_status: string;
  result_path: string;
  severity: "info" | "warning" | "error";
  summary: string;
  observed_at: string;
  created_at: string;
  suggested_next_action: string;
  timestamp?: string;
  caller_classification?: "public" | "authenticated" | "local" | "connector" | "unknown";
  operation?: string;
  allowed?: boolean;
  reason?: string;
  acknowledged: boolean;
  unread: boolean;
  dedupe_key: string;
  retention_policy: string;
};

export class AgentRunnerStatusService {
  constructor(private readonly repoRoot: string, private readonly options: StatusServiceOptions = {}) {}

  async status(input: AgentRunnerStatusInput): Promise<AgentRunnerStatusResult> {
    const polling = normalizePolling(input);
    if (polling.count <= 1) {
      const snapshot = await this.readStatusSnapshot(input);
      return withPollingFields(snapshot, polling, [], "single_shot");
    }

    const pollHistory: PollHistoryEntry[] = [];
    const liveTailCursors = new Map<string, number>();
    let monitoredRunId = "";
    let finalSnapshot: StatusSnapshot | undefined;
    let stopReason: MonitoringStopReason | "" = "";

    for (let pollIndex = 1; pollIndex <= polling.count; pollIndex += 1) {
      finalSnapshot = await this.readStatusSnapshot(input);
      monitoredRunId = monitoredRunId || finalSnapshot.active_run_id || finalSnapshot.active_run_ids[0] || "";
      pollHistory.push(buildPollHistoryEntry(finalSnapshot, pollIndex, monitoredRunId, liveTailCursors));
      stopReason = monitoringStopReason(finalSnapshot, monitoredRunId);
      if (stopReason) {
        break;
      }
      if (pollIndex < polling.count) {
        await this.sleep(polling.intervalSeconds * 1000);
      }
    }

    if (!finalSnapshot) {
      finalSnapshot = await this.readStatusSnapshot(input);
    }
    return withPollingFields(finalSnapshot, polling, pollHistory, stopReason || "poll_count_reached");
  }

  private async sleep(milliseconds: number): Promise<void> {
    if (this.options.sleep) {
      await this.options.sleep(milliseconds);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private async readStatusSnapshot(input: AgentRunnerStatusInput): Promise<StatusSnapshot> {
    const heartbeatStaleSeconds = input.heartbeat_stale_seconds ?? 60;
    const staleLockSeconds = input.stale_lock_seconds ?? 900;
    const heartbeat = await this.readHeartbeat(heartbeatStaleSeconds);
    const connector = getConnectorDiagnostics();
    const connectorIdentity = buildConnectorIdentitySnapshot();
    const runs = await this.classifyRuns(staleLockSeconds);
    const counts = countRuns(runs);
    const runnerState = heartbeat.alive ? "alive" : heartbeat.exists && heartbeat.age_seconds !== null ? "stale" : "dead";
    const runner = heartbeat.exists ? runnerState : "unknown";
    const worker = heartbeat.alive ? "running" : heartbeat.exists ? "not_running" : "unknown";
    const lastRun = latestRun(runs.filter((run) => run.state !== "pending")) ?? latestRun(runs);
    const readyResults = await this.readyResults(runs);
    const queueEntries = queueEntriesForRuns(runs);
    const heartbeatActiveRunIds = heartbeat.active_run_ids.length > 0
      ? heartbeat.active_run_ids
      : heartbeat.active_run_id
        ? [heartbeat.active_run_id]
        : [];
    const activeRunIdsForTail = uniqueStrings([
      ...heartbeatActiveRunIds,
      ...runs.filter((run) => run.state === "active_locked").map((run) => run.run_id)
    ]);
    const activeRunLiveTailGroups = await Promise.all(activeRunIdsForTail.map(async (activeRunId) => {
      const tail = await this.liveTail({
        repo_id: input.repo_id,
        run_id: activeRunId,
        max_events: input.live_tail_max_events ?? 15
      });
      return tail.events.map((event) => ({ ...event, run_id: activeRunId }));
    }));
    const activeRunLiveTail = activeRunLiveTailGroups.flat();
    const eventInbox = await this.eventInbox(input.repo_id, runnerState, heartbeat, runs, readyResults);
    const recentEvents = eventInbox.recent_events;
    const lastRunStatus = lastRun?.state.replace("_locked", "") ?? "";
    const warnings = [...heartbeat.warnings];
    if (connector.connector_status === "degraded" || connector.connector_status === "terminated" || connector.connector_status === "stale") {
      warnings.push("CONNECTOR_SESSION_DEGRADED");
    }
    const activeLocks = runs
      .filter((run) => run.state === "active_locked" && run.lock_path)
      .map((run) => ({
        run_id: run.run_id,
        lock_path: run.lock_path ?? "",
        lock_age_seconds: run.lock_age_seconds ?? 0,
        runner_pid: run.runner_pid ?? null,
        child_pid: run.child_pid ?? null,
        worker_slot_id: run.worker_slot_id ?? null,
        result_md_exists: run.result_md_exists ?? false
      }));
    for (const lock of activeLocks) {
      if (lock.runner_pid === null) {
        warnings.push("ACTIVE_LOCK_PID_MISSING");
      }
    }
    const staleLocks = runs
      .filter((run) => run.state === "stale_locked" && run.lock_path)
      .map((run) => ({
        run_id: run.run_id,
        lock_path: run.lock_path ?? "",
        lock_age_seconds: run.lock_age_seconds ?? 0,
        runner_pid: run.runner_pid ?? null,
        stale_reason: run.stale_reason ?? "",
        pid_status: run.pid_status ?? "",
        suggested_next_action: run.suggested_next_action ?? "write_blocked_result_and_clear_abandoned_lock",
        recovery_policy: "blocked_result_then_clear_abandoned_lock",
        recovery_safe: true,
        result_conversion_status: run.result_md_exists ? "already_terminal" : "pending_blocked_result_conversion",
        result_md_exists: run.result_md_exists ?? false,
        runtime_assessment: assessRun({
          run,
          heartbeat,
          heartbeatActive: heartbeat.active_run_id === run.run_id,
          source: heartbeat.active_run_id === run.run_id ? "heartbeat_and_lock" : "lock"
        })
      }));
    const completedWithLockWarnings = runs
      .filter((run) => run.state === "completed_with_lock_warning" && run.lock_path)
      .map((run) => ({
        run_id: run.run_id,
        lock_path: run.lock_path ?? "",
        lock_age_seconds: run.lock_age_seconds ?? 0,
        runner_pid: run.runner_pid ?? null,
        child_pid: run.child_pid ?? null,
        worker_slot_id: run.worker_slot_id ?? null,
        result_md_exists: true
      }));
    if (completedWithLockWarnings.length > 0) {
      warnings.push("COMPLETED_RESULT_HAS_LOCK");
    }
    const activeRuns = activeRunDetails(heartbeatActiveRunIds, activeLocks, runs, heartbeat);
    const activeRunIds = activeRuns.map((run) => run.run_id);
    const primaryActiveRunId = heartbeat.active_run_id || activeRunIds[0] || "";
    const runtimeAssessment = assessRuntime(runnerState, heartbeat.status, counts, activeRuns.length);
    const maxParallelRuns = heartbeat.max_parallel_runs;
    const workerSlots = heartbeat.worker_slots;
    const activeWorkerSlots = workerSlots.filter((slot) => slot.state === "active").length;
    const idleWorkerSlots = workerSlots.filter((slot) => slot.state === "idle").length;
    const queuedBecauseAtCapacity = counts.pending > 0 && counts.active_locked >= maxParallelRuns;
    const heartbeatAgeText = heartbeat.age_seconds === null ? "unknown" : `${Math.round(heartbeat.age_seconds)} sec ago`;
    const plainTextLines = [
      `Runner: ${runnerState}`,
      `Connector: ${connector.connector_status}`,
      `Runtime assessment: ${runtimeAssessment}`,
      `Last heartbeat: ${heartbeatAgeText}`,
      `Heartbeat status: ${heartbeat.status}`,
      `Max parallel runs: ${maxParallelRuns}`,
      `Worker slots: ${activeWorkerSlots} active / ${idleWorkerSlots} idle`,
      `Queued because at capacity: ${queuedBecauseAtCapacity ? "yes" : "no"}`,
      `Pending: ${counts.pending}`,
      `Active: ${counts.active_locked}`,
      `Stale locks: ${counts.stale_locked}`,
      `Completed: ${counts.completed}`,
      `Blocked: ${counts.blocked}`,
      `Last run: ${lastRun?.run_id ?? "none"}; status: ${lastRunStatus || "none"}`
    ];
    if (connector.last_connector_error_kind) {
      plainTextLines.push(`Connector last error: ${connector.last_connector_error_kind}; tool: ${connector.last_failed_tool_call || "unknown"}`);
      plainTextLines.push(`Connector suggested next action: ${connector.suggested_next_action}`);
    }
    for (const activeRun of activeRuns) {
      plainTextLines.push(`Active run: ${activeRun.run_id}; source: ${activeRun.source}`);
    }
    for (const [tailRunId, tailEvents] of groupLiveTailByRun(activeRunLiveTail)) {
      if (tailEvents.length > 0) {
        plainTextLines.push(`Live tail for ${tailRunId}:`);
        for (const event of tailEvents) {
          plainTextLines.push(`${event.sequence} ${event.event_type}: ${event.summary}${event.path ? ` (${event.path})` : ""}`);
        }
      }
    }
    const readyResult = readyResults[0];
    if (readyResult) {
      plainTextLines.push(`Ready result: ${readyResult.run_id}`);
      plainTextLines.push(`Ready result status: ${readyResult.result_status}`);
      plainTextLines.push(`Ready result path: ${readyResult.result_path}`);
      const previewUrl = readyResult.preview_urls.find((url) => !url.includes("127.0.0.1")) ?? readyResult.preview_urls[0];
      if (previewUrl) {
        plainTextLines.push(`Preview URL: ${previewUrl}`);
      }
    }
    for (const staleLock of staleLocks.slice(0, 2)) {
      plainTextLines.push(`Stale run: ${staleLock.run_id}; reason: ${staleLock.stale_reason}; pid_status: ${staleLock.pid_status}`);
      plainTextLines.push(`Suggested next action: ${staleLock.suggested_next_action}`);
    }
    const plainText = plainTextLines.join("\n");

    return {
      ok: true,
      repo_id: input.repo_id,
      connector_status: connector.connector_status,
      last_connector_success_at: connector.last_connector_success_at,
      last_connector_error_at: connector.last_connector_error_at,
      last_connector_error_kind: connector.last_connector_error_kind,
      last_successful_tool_call: connector.last_successful_tool_call,
      last_failed_tool_call: connector.last_failed_tool_call,
      suspected_cause: connector.suspected_cause,
      suggested_next_action: connector.suggested_next_action,
      server_started_at: connector.server_started_at,
      current_uptime_seconds: connector.current_uptime_seconds,
      tool_catalog_hash: connector.tool_catalog_hash,
      contract_schema_version: connector.contract_schema_version,
      auth_status: connector.auth_status,
      connector_identity: connectorIdentity,
      runner_state: runnerState,
      runner,
      worker,
      runtime_assessment: runtimeAssessment,
      heartbeat_path: "projects/agent-runner/reports/runner-heartbeat.json",
      heartbeat_updated_at: heartbeat.updated_at,
      heartbeat_age_seconds: heartbeat.age_seconds,
      heartbeat_status: heartbeat.status,
      runner_pid: heartbeat.runner_pid,
      active_run_id: heartbeat.alive && counts.active_locked > 0 ? primaryActiveRunId : "",
      max_parallel_runs: maxParallelRuns,
      worker_slot_count: workerSlots.length,
      active_worker_slots: activeWorkerSlots,
      idle_worker_slots: idleWorkerSlots,
      queued_because_at_capacity: queuedBecauseAtCapacity,
      worker_slots: workerSlots,
      active_locks: activeLocks,
      stale_locks: staleLocks,
      completed_with_lock_warnings: completedWithLockWarnings,
      active_run_ids: activeRunIds,
      active_runs: activeRuns,
      pending_count: counts.pending,
      active_count: counts.active_locked,
      stale_lock_count: counts.stale_locked,
      completed_count: counts.completed,
      blocked_count: counts.blocked,
      last_run_id: lastRun?.run_id ?? "",
      last_run_status: lastRunStatus,
      ready_results: readyResults,
      active_run_live_tail: activeRunLiveTail,
      queue_entries: queueEntries,
      recent_events: recentEvents,
      unresolved_events: eventInbox.unresolved_events,
      event_log_path: EVENT_LOG_PATH,
      event_cursor: eventInbox.event_cursor,
      event_count: eventInbox.event_count,
      unresolved_event_count: eventInbox.unresolved_event_count,
      acknowledgement_policy: eventInbox.acknowledgement_policy,
      plain_text: plainText,
      warnings: [...new Set(warnings)]
    };
  }

  async liveTail(input: RunLiveTailInput): Promise<RunLiveTailResult> {
    const maxEvents = input.max_events ?? 20;
    const cursor = parseCursor(input.cursor);
    const runDir = join(this.repoRoot, ".chatgpt/codex-runs", input.run_id);
    const resultPath = `.chatgpt/codex-runs/${input.run_id}/RESULT.md`;
    const [events, resultStatus] = await Promise.all([
      this.readRunLiveEvents(input.run_id),
      exists(join(runDir, "RESULT.md")).then(async (hasResult) => hasResult ? await readResultStatus(join(runDir, "RESULT.md")) || "completed" : "")
    ]);
    const withSynthetic = await this.withSyntheticLiveEvents(input.run_id, events);
    const filtered = withSynthetic.filter((event) => event.sequence > cursor).slice(-maxEvents);
    const nextCursor = filtered.at(-1)?.cursor ?? input.cursor ?? "";
    const terminal = Boolean(resultStatus);
    return {
      ok: true,
      repo_id: input.repo_id,
      run_id: input.run_id,
      events: filtered,
      next_cursor: nextCursor,
      terminal,
      result_status: resultStatus,
      result_path: resultPath,
      warnings: []
    };
  }

  private async eventInbox(
    repoId: string,
    runnerState: "alive" | "dead" | "stale",
    heartbeat: { active_run_id: string; age_seconds: number | null; pid_status: string },
    runs: ClassifiedRun[],
    readyResults: AgentRunnerStatusResult["ready_results"]
  ): Promise<{
    recent_events: BridgeEvent[];
    unresolved_events: BridgeEvent[];
    event_cursor: string;
    event_count: number;
    unresolved_event_count: number;
    acknowledgement_policy: string;
  }> {
    const derived = recentEventsForStatus(repoId, runnerState, heartbeat, runs, readyResults);
    const current = await readEventLog(this.repoRoot);
    const recovered = staleRecoveryEvents(repoId, current, runs);
    const derivedEvents = [...derived, ...recovered];
    const byDedupe = new Map(current.map((event) => [event.dedupe_key, event]));
    const merged = [...current];
    for (const event of derivedEvents) {
      if (byDedupe.has(event.dedupe_key)) {
        continue;
      }
      byDedupe.set(event.dedupe_key, event);
      merged.push(event);
    }
    const retained = merged.slice(-EVENT_RETENTION_LIMIT);
    if (retained.length !== current.length || derivedEvents.some((event) => !current.some((existing) => existing.dedupe_key === event.dedupe_key))) {
      await writeEventLog(this.repoRoot, retained);
    }
    const recent = retained.slice(-10).reverse();
    const unresolved = retained.filter((event) => !event.acknowledged && event.unread !== false);
    return {
      recent_events: recent,
      unresolved_events: unresolved.slice(-10).reverse(),
      event_cursor: retained.at(-1)?.event_id ?? "",
      event_count: retained.length,
      unresolved_event_count: unresolved.length,
      acknowledgement_policy: "Events are unresolved while acknowledged=false and unread=true; status reads do not acknowledge events."
    };
  }

  private async readRunLiveEvents(runId: string): Promise<LiveTailEvent[]> {
    const eventPath = join(this.repoRoot, ".chatgpt/codex-runs", runId, "events.jsonl");
    let raw = "";
    try {
      raw = await readFile(eventPath, "utf8");
    } catch {
      return [];
    }
    const events: LiveTailEvent[] = [];
    let sequence = 0;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      sequence += 1;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const eventType = safeEventText(parsed.event_type, "unknown_event");
        const timestamp = safeEventText(parsed.timestamp, "");
        const summary = redactLiveTailText(safeEventText(parsed.summary, eventType));
        const path = safeRepoPath(typeof parsed.path === "string" ? parsed.path : "");
        events.push({
          sequence,
          timestamp,
          event_type: eventType,
          summary,
          ...(path ? { path } : {}),
          cursor: String(sequence)
        });
      } catch {
        events.push({
          sequence,
          timestamp: "",
          event_type: "invalid_event",
          summary: "Skipped malformed live-tail event.",
          cursor: String(sequence)
        });
      }
    }
    return events;
  }

  private async withSyntheticLiveEvents(runId: string, events: LiveTailEvent[]): Promise<LiveTailEvent[]> {
    const nextSequence = () => events.length === 0 ? 1 : Math.max(...events.map((event) => event.sequence)) + 1;
    const resultPath = join(this.repoRoot, ".chatgpt/codex-runs", runId, "RESULT.md");
    if (await exists(resultPath) && !events.some((event) => event.event_type === "result_written")) {
      events.push({
        sequence: nextSequence(),
        timestamp: "",
        event_type: "result_written",
        summary: "RESULT.md exists for this run.",
        path: `.chatgpt/codex-runs/${runId}/RESULT.md`,
        cursor: String(nextSequence())
      });
    }
    const stderrPath = join(this.repoRoot, "projects/agent-runner/reports/codex-exec", runId, "stderr.log");
    if (await exists(stderrPath)) {
      const stderr = tail(redactLiveTailText(await readFile(stderrPath, "utf8")), 800);
      if (stderr.trim()) {
        const sequence = nextSequence();
        events.push({
          sequence,
          timestamp: "",
          event_type: "command_output_tail",
          summary: `Codex stderr tail: ${stderr.replace(/\s+/g, " ").slice(0, 700)}`,
          path: `projects/agent-runner/reports/codex-exec/${runId}/stderr.log`,
          cursor: String(sequence)
        });
      }
    }
    return events.sort((left, right) => left.sequence - right.sequence).map((event, index) => ({
      ...event,
      sequence: index + 1,
      cursor: String(index + 1)
    }));
  }

  private async readHeartbeat(staleSeconds: number): Promise<{
    exists: boolean;
    updated_at: string;
    age_seconds: number | null;
    status: string;
    active_run_id: string;
    active_run_ids: string[];
    max_parallel_runs: number;
    worker_slots: WorkerSlot[];
    runner_pid: number | null;
    pid_status: "alive" | "dead" | "missing" | "unknown";
    alive: boolean;
    warnings: string[];
  }> {
    const heartbeatPath = join(this.repoRoot, "projects/agent-runner/reports/runner-heartbeat.json");
    let raw = "";
    try {
      raw = await readFile(heartbeatPath, "utf8");
    } catch {
      return {
        exists: false,
        updated_at: "",
        age_seconds: null,
        status: "missing",
        active_run_id: "",
        active_run_ids: [],
        max_parallel_runs: 1,
        worker_slots: [],
        runner_pid: null,
        pid_status: "missing",
        alive: false,
        warnings: ["AGENT_RUNNER_HEARTBEAT_MISSING"]
      };
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const updatedAt = typeof parsed.updated_at === "string" ? parsed.updated_at : "";
      const timestamp = Date.parse(updatedAt);
      const ageSeconds = Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 1000) : null;
      const status = typeof parsed.status === "string" ? parsed.status : "unknown";
      const activeRunId = typeof parsed.active_run_id === "string" ? parsed.active_run_id : "";
      const parsedActiveRunIds = Array.isArray(parsed.active_run_ids)
        ? parsed.active_run_ids.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];
      const activeRunIds = parsedActiveRunIds.length > 0 ? parsedActiveRunIds : activeRunId ? [activeRunId] : [];
      const maxParallelRuns = typeof parsed.max_parallel_runs === "number" && Number.isInteger(parsed.max_parallel_runs) && parsed.max_parallel_runs > 0
        ? parsed.max_parallel_runs
        : Math.max(1, activeRunIds.length);
      const workerSlots = parseWorkerSlots(parsed.worker_slots);
      const runnerPid = typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : null;
      const pidStatus = runnerPid === null ? "missing" : await processStatus(runnerPid);
      const pidAllowsAlive = activeRunIds.length === 0 || runnerPid === null || pidStatus === "alive";
      const alive = ageSeconds !== null && ageSeconds <= staleSeconds && ACTIVE_HEARTBEAT_STATUSES.has(status) && pidAllowsAlive;
      return {
        exists: true,
        updated_at: updatedAt,
        age_seconds: ageSeconds,
        status,
        active_run_id: activeRunId,
        active_run_ids: activeRunIds,
        max_parallel_runs: maxParallelRuns,
        worker_slots: workerSlots,
        runner_pid: runnerPid,
        pid_status: pidStatus,
        alive,
        warnings: alive ? [] : [pidStatus === "dead" ? "AGENT_RUNNER_PID_DEAD" : "AGENT_RUNNER_NOT_ALIVE"]
      };
    } catch {
      return {
        exists: true,
        updated_at: "",
        age_seconds: null,
        status: "invalid",
        active_run_id: "",
        active_run_ids: [],
        max_parallel_runs: 1,
        worker_slots: [],
        runner_pid: null,
        pid_status: "unknown",
        alive: false,
        warnings: ["AGENT_RUNNER_HEARTBEAT_INVALID"]
      };
    }
  }

  private async classifyRuns(staleLockSeconds: number): Promise<ClassifiedRun[]> {
    const runsRoot = join(this.repoRoot, ".chatgpt/codex-runs");
    let entries: string[];
    try {
      entries = await readdir(runsRoot);
    } catch {
      return [];
    }

    const runs: ClassifiedRun[] = [];
    for (const runId of entries.sort()) {
      const runDir = join(runsRoot, runId);
      const [prompt, runJson, result, lock] = await Promise.all([
        exists(join(runDir, "PROMPT.md")),
        exists(join(runDir, "run.json")),
        exists(join(runDir, "RESULT.md")),
        exists(join(runDir, "RESULT.md.lock"))
      ]);
      if (result) {
        const resultPath = join(runDir, "RESULT.md");
        const [status, resultInfo] = await Promise.all([
          readResultStatus(resultPath),
          stat(resultPath)
        ]);
        const lockPath = join(runDir, "RESULT.md.lock");
        const lockInfo = lock ? await stat(lockPath) : null;
        const lockMetadata = lock ? await readLockMetadata(lockPath) : {};
        runs.push({
          run_id: runId,
          state: status === "blocked" ? "blocked" : lock ? "completed_with_lock_warning" : "completed",
          result_status: status || (lock ? "completed_with_lock_warning" : "completed"),
          result_path: `.chatgpt/codex-runs/${runId}/RESULT.md`,
          result_mtime_ms: resultInfo.mtimeMs,
          lock_path: lock ? `.chatgpt/codex-runs/${runId}/RESULT.md.lock` : undefined,
          lock_age_seconds: lockInfo ? Math.max(0, (Date.now() - lockInfo.mtimeMs) / 1000) : undefined,
          runner_pid: lockMetadata.runner_pid ?? null,
          child_pid: lockMetadata.child_pid ?? null,
          worker_slot_id: lockMetadata.worker_slot_id ?? null,
          result_md_exists: true
        });
      } else if (lock) {
        const lockPath = join(runDir, "RESULT.md.lock");
        const lockInfo = await stat(lockPath);
        const ageSeconds = Math.max(0, (Date.now() - lockInfo.mtimeMs) / 1000);
        const lockMetadata = await readLockMetadata(lockPath);
        const lockPid = lockMetadata.runner_pid ?? null;
        const pidStatus = lockPid === null ? "missing" : await processStatus(lockPid);
        const deadPid = pidStatus === "dead";
        const state = deadPid || ageSeconds >= staleLockSeconds ? "stale_locked" : "active_locked";
        const recentMtime = await newestRunDirectoryMtimeMs(runDir);
        const staleReason = deadPid ? "dead_pid" : ageSeconds >= staleLockSeconds ? "lock_age_exceeded" : "";
        runs.push({
          run_id: runId,
          state,
          lock_path: `.chatgpt/codex-runs/${runId}/RESULT.md.lock`,
          lock_age_seconds: ageSeconds,
          runner_pid: lockPid,
          child_pid: lockMetadata.child_pid ?? null,
          worker_slot_id: lockMetadata.worker_slot_id ?? null,
          pid_status: pidStatus,
          stale_reason: staleReason,
          suggested_next_action: state === "stale_locked" ? "write_blocked_result_and_clear_abandoned_lock" : "wait_or_inspect_active_runner",
          result_md_exists: false,
          run_dir_recent_mtime_ms: recentMtime
        });
      } else if (prompt && runJson) {
        runs.push({ run_id: runId, state: "pending", suggested_next_action: "wait_for_worker_or_start_runner" });
      } else {
        runs.push({ run_id: runId, state: "blocked", suggested_next_action: "inspect_run_directory" });
      }
    }
    return runs;
  }

  private async readyResults(runs: ClassifiedRun[]): Promise<AgentRunnerStatusResult["ready_results"]> {
    const readableResults = runs
      .filter((run) => (
        run.state === "completed" ||
        run.state === "completed_with_lock_warning" ||
        (run.state === "blocked" && run.result_path)
      ) && run.result_path)
      .sort((left, right) => (right.result_mtime_ms ?? 0) - (left.result_mtime_ms ?? 0))
      .slice(0, 3);
    const ready = await Promise.all(readableResults.map(async (run) => {
      const resultPath = run.result_path ?? "";
      const resultText = await readFile(join(this.repoRoot, resultPath), "utf8");
      return {
        run_id: run.run_id,
        result_status: run.result_status ?? run.state,
        result_path: resultPath,
        result_text: tail(resultText, 16000),
        preview_urls: extractUrls(resultText)
      };
    }));
    return ready;
  }
}

function normalizePolling(input: AgentRunnerStatusInput): { count: number; intervalSeconds: number } {
  const raw = input as AgentRunnerStatusInput & {
    poll_count?: unknown;
    poll_interval_seconds?: unknown;
  };
  const count = boundedInteger(raw.poll_count, 1, 1, MAX_POLL_COUNT);
  const intervalSeconds = count > 1
    ? boundedInteger(raw.poll_interval_seconds, DEFAULT_POLL_INTERVAL_SECONDS, MIN_POLL_INTERVAL_SECONDS, MAX_POLL_INTERVAL_SECONDS)
    : 0;
  return { count, intervalSeconds };
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function withPollingFields(
  snapshot: StatusSnapshot,
  polling: { count: number; intervalSeconds: number },
  pollHistory: PollHistoryEntry[],
  stopReason: MonitoringStopReason
): AgentRunnerStatusResult {
  const plainText = pollHistory.length > 0
    ? `${snapshot.plain_text}\nMonitoring polls: ${pollHistory.length}; stop reason: ${stopReason}`
    : snapshot.plain_text;
  return {
    ...snapshot,
    poll_count: polling.count,
    poll_interval_seconds: polling.intervalSeconds,
    monitoring_stop_reason: stopReason,
    poll_history: pollHistory,
    plain_text: plainText
  };
}

function buildPollHistoryEntry(
  status: StatusSnapshot,
  pollIndex: number,
  monitoredRunId: string,
  liveTailCursors: Map<string, number>
): PollHistoryEntry {
  const activeRunId = status.active_run_id || status.active_run_ids[0] || "";
  const tailRunId = activeRunId || monitoredRunId;
  const previousCursor = tailRunId ? liveTailCursors.get(tailRunId) ?? 0 : 0;
  const liveTailEvents = tailRunId
    ? status.active_run_live_tail.filter((event) => event.sequence > previousCursor)
    : [];
  if (tailRunId && status.active_run_live_tail.length > 0) {
    liveTailCursors.set(tailRunId, Math.max(previousCursor, ...status.active_run_live_tail.map((event) => event.sequence)));
  }
  const observedRunId = monitoredRunId || activeRunId || status.last_run_id;
  const queueEntry = queueEntryForRun(status, observedRunId);
  const readyResult = status.ready_results.find((result) => result.run_id === observedRunId) ?? status.ready_results[0];
  return {
    poll_index: pollIndex,
    observed_at: new Date().toISOString(),
    heartbeat_updated_at: status.heartbeat_updated_at,
    heartbeat_age_seconds: status.heartbeat_age_seconds,
    event_count: status.event_count,
    event_cursor: status.event_cursor,
    active_count: status.active_count,
    active_run_id: activeRunId,
    last_run_status: status.last_run_status,
    result_md_exists: Boolean(queueEntryValue(queueEntry, "result_md_exists") ?? readyResult),
    preview_urls: readyResult?.preview_urls ?? [],
    live_tail_events: liveTailEvents
  };
}

function monitoringStopReason(status: StatusSnapshot, monitoredRunId: string): MonitoringStopReason | "" {
  if (!monitoredRunId && status.active_count === 0) {
    return "no_active_run";
  }
  const queueEntry = queueEntryForRun(status, monitoredRunId);
  if (Boolean(queueEntryValue(queueEntry, "result_md_exists"))) {
    return "result_md_exists";
  }
  if (Boolean(queueEntryValue(queueEntry, "terminal"))) {
    return "terminal_result";
  }
  return "";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function groupLiveTailByRun(events: LiveTailEvent[]): Array<[string, LiveTailEvent[]]> {
  const groups = new Map<string, LiveTailEvent[]>();
  for (const event of events) {
    const runId = event.run_id ?? "";
    if (!runId) {
      continue;
    }
    groups.set(runId, [...(groups.get(runId) ?? []), event]);
  }
  return [...groups.entries()];
}

function parseWorkerSlots(value: unknown): WorkerSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const slots: WorkerSlot[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const slotId = typeof record.slot_id === "number" && Number.isInteger(record.slot_id) && record.slot_id > 0
      ? record.slot_id
      : slots.length + 1;
    const rawState = typeof record.state === "string" ? record.state : "unknown";
    const state: WorkerSlot["state"] = rawState === "active" || rawState === "idle" ? rawState : "unknown";
    slots.push({
      slot_id: slotId,
      state,
      run_id: typeof record.run_id === "string" ? record.run_id : "",
      pid: typeof record.pid === "number" && Number.isInteger(record.pid) && record.pid > 0 ? record.pid : null,
      started_at: typeof record.started_at === "string" ? record.started_at : "",
      heartbeat_age_seconds: typeof record.heartbeat_age_seconds === "number" ? record.heartbeat_age_seconds : null
    });
  }
  return slots;
}

function queueEntryForRun(status: StatusSnapshot, runId: string): Record<string, unknown> | undefined {
  if (!runId) {
    return undefined;
  }
  return status.queue_entries.find((entry) => queueEntryValue(entry, "run_id") === runId) as Record<string, unknown> | undefined;
}

function queueEntryValue(entry: unknown, key: string): unknown {
  return typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>)[key] : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function parseCursor(cursor?: string): number {
  const parsed = Number.parseInt(cursor ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function safeEventText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1000) : fallback;
}

function safeRepoPath(path: string): string {
  if (!path) {
    return "";
  }
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes("..") || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) {
    return "";
  }
  if (/(^|\/)\.env($|[./-])|secret|token|credential|auth|session/i.test(normalized)) {
    return "[redacted-path]";
  }
  return normalized.slice(0, 240);
}

function redactLiveTailText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization|x-bridge-auth-token|api[_-]?key|token|secret|password|session[_-]?id)\s*[:=]\s*["']?[^"',\s)]+/gi, "$1=[REDACTED]")
    .replace(/[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[REDACTED-CREDENTIALS]@[REDACTED-HOST]")
    .replace(/\b[0-9a-f]{24,}\b/gi, "[REDACTED-ID]")
    .slice(0, 2000);
}

async function readResultStatus(path: string): Promise<string> {
  const text = await readFile(path, "utf8");
  const match = text.match(/^\s*status:\s*(.+?)\s*$/im);
  return match?.[1]?.trim().toLowerCase() ?? "";
}

async function readLockMetadata(path: string): Promise<{
  runner_pid?: number;
  child_pid?: number;
  worker_slot_id?: number;
}> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
  const runnerPid = parsed.runner_pid ?? parsed.pid;
  const childPid = parsed.child_pid;
  const workerSlotId = parsed.worker_slot_id;
  return {
    runner_pid: typeof runnerPid === "number" && Number.isInteger(runnerPid) && runnerPid > 0 ? runnerPid : undefined,
    child_pid: typeof childPid === "number" && Number.isInteger(childPid) && childPid > 0 ? childPid : undefined,
    worker_slot_id: typeof workerSlotId === "number" && Number.isInteger(workerSlotId) && workerSlotId > 0 ? workerSlotId : undefined
  };
}

async function processIsAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function processStatus(pid: number): Promise<"alive" | "dead" | "unknown"> {
  try {
    return await processIsAlive(pid) ? "alive" : "dead";
  } catch {
    return "unknown";
  }
}

function countRuns(runs: ClassifiedRun[]): Record<ClassifiedRun["state"], number> {
  return {
    pending: runs.filter((run) => run.state === "pending").length,
    active_locked: runs.filter((run) => run.state === "active_locked").length,
    stale_locked: runs.filter((run) => run.state === "stale_locked").length,
    completed: runs.filter((run) => run.state === "completed" || run.state === "completed_with_lock_warning").length,
    completed_with_lock_warning: runs.filter((run) => run.state === "completed_with_lock_warning").length,
    blocked: runs.filter((run) => run.state === "blocked").length
  };
}

function latestRun(runs: ClassifiedRun[]): ClassifiedRun | undefined {
  return [...runs].sort((left, right) => left.run_id.localeCompare(right.run_id)).at(-1);
}

function queueEntriesForRuns(runs: ClassifiedRun[]): AgentRunnerStatusResult["queue_entries"] {
  return [...runs]
    .sort((left, right) => left.run_id.localeCompare(right.run_id))
    .map((run) => {
      const resultMdExists = run.result_md_exists ?? (
        run.state === "completed" ||
        run.state === "completed_with_lock_warning" ||
        (run.state === "blocked" && Boolean(run.result_path))
      );
      const readyResultAvailable = Boolean(run.result_path) && (
        run.state === "completed" ||
        run.state === "completed_with_lock_warning" ||
        (run.state === "blocked" && resultMdExists)
      );
      const terminal = run.state === "completed" ||
        run.state === "completed_with_lock_warning" ||
        (run.state === "blocked" && resultMdExists);
      return {
        run_id: run.run_id,
        state: run.state,
        prompt_path: `.chatgpt/codex-runs/${run.run_id}/PROMPT.md`,
        run_json_path: `.chatgpt/codex-runs/${run.run_id}/run.json`,
        result_path: run.result_path ?? `.chatgpt/codex-runs/${run.run_id}/RESULT.md`,
        lock_path: run.lock_path ?? "",
        lock_age_seconds: run.lock_age_seconds ?? null,
        runner_pid: run.runner_pid ?? null,
        child_pid: run.child_pid ?? null,
        worker_slot_id: run.worker_slot_id ?? null,
        result_md_exists: resultMdExists,
        result_status: run.result_status ?? (resultMdExists ? run.state : ""),
        stale_reason: run.stale_reason ?? "",
        pid_status: run.pid_status ?? "",
        suggested_next_action: run.suggested_next_action ?? "",
        recovery_policy: run.state === "stale_locked" ? "blocked_result_then_clear_abandoned_lock" : "",
        recovery_safe: run.state === "stale_locked",
        result_conversion_status: run.state === "stale_locked" && !resultMdExists ? "pending_blocked_result_conversion" : resultMdExists ? "already_terminal" : "",
        ready_result_available: readyResultAvailable,
        terminal
      };
    });
}

function recentEventsForStatus(
  repoId: string,
  runnerState: "alive" | "dead" | "stale",
  heartbeat: { active_run_id: string; age_seconds: number | null; pid_status: string },
  runs: ClassifiedRun[],
  readyResults: AgentRunnerStatusResult["ready_results"]
): BridgeEvent[] {
  const events: BridgeEvent[] = [];
  const observedAt = new Date().toISOString();
  for (const run of runs.filter((row) => row.state === "pending")) {
    events.push(makeEvent({
      repoId,
      runId: run.run_id,
      eventType: "run_created",
      resultStatus: "",
      resultPath: `.chatgpt/codex-runs/${run.run_id}/RESULT.md`,
      severity: "info",
      summary: `${run.run_id} is queued and awaiting runner pickup.`,
      observedAt,
      suggestedNextAction: run.suggested_next_action ?? "wait_for_worker_or_start_runner"
    }));
  }
  for (const run of runs.filter((row) => row.state === "active_locked")) {
    events.push(makeEvent({
      repoId,
      runId: run.run_id,
      eventType: "run_claimed",
      resultStatus: "",
      resultPath: `.chatgpt/codex-runs/${run.run_id}/RESULT.md`,
      severity: "info",
      summary: `${run.run_id} is claimed by the runner.`,
      observedAt,
      suggestedNextAction: "observe_active_run"
    }));
  }
  for (const run of runs.filter((row) => row.state === "stale_locked")) {
    events.push(makeEvent({
      repoId,
      runId: run.run_id,
      eventType: "stale_lock_detected",
      resultStatus: "",
      resultPath: run.result_path ?? `.chatgpt/codex-runs/${run.run_id}/RESULT.md`,
      severity: "warning",
      summary: `Stale lock detected for ${run.run_id}: ${run.stale_reason || "unknown reason"}.`,
      observedAt,
      suggestedNextAction: run.suggested_next_action ?? "write_blocked_result_and_clear_abandoned_lock",
      dedupeSuffix: run.stale_reason || "unknown"
    }));
  }
  if (runnerState === "stale") {
    events.push(makeEvent({
      repoId,
      runId: heartbeat.active_run_id,
      eventType: "runner_stale",
      resultStatus: "",
      resultPath: "",
      severity: "warning",
      summary: heartbeat.pid_status === "dead" ? "Runner heartbeat references a dead PID." : "Runner heartbeat is stale or not active.",
      observedAt,
      suggestedNextAction: "inspect_stale_locks_and_restart_worker"
    }));
  }
  if (runnerState === "alive") {
    events.push(makeEvent({
      repoId,
      runId: heartbeat.active_run_id,
      eventType: "runner_recovered",
      resultStatus: "",
      resultPath: "",
      severity: "info",
      summary: "Runner heartbeat is fresh and worker appears available.",
      observedAt,
      suggestedNextAction: "observe_only",
      dedupeSuffix: "alive"
    }));
  }
  if (runs.filter((row) => row.state === "pending").length >= 5) {
    events.push(makeEvent({
      repoId,
      runId: "",
      eventType: "queue_backlog_detected",
      resultStatus: "",
      resultPath: "",
      severity: "warning",
      summary: "Pending queue backlog detected.",
      observedAt,
      suggestedNextAction: "recommend_next_action"
    }));
  }
  for (const result of readyResults) {
    const status = result.result_status.toLowerCase();
    events.push(makeEvent({
      repoId,
      runId: result.run_id,
      eventType: status === "blocked" ? "run_blocked" : status === "timed_out" ? "run_timed_out" : status === "failed" ? "run_failed" : "run_completed",
      resultStatus: result.result_status,
      resultPath: result.result_path,
      severity: status === "blocked" ? "warning" : status === "failed" || status === "timed_out" ? "error" : "info",
      summary: `${result.run_id} wrote RESULT.md with status ${result.result_status}.`,
      observedAt,
      suggestedNextAction: "review_ready_result"
    }));
  }
  return events.slice(0, 10);
}

function staleRecoveryEvents(repoId: string, current: BridgeEvent[], runs: ClassifiedRun[]): BridgeEvent[] {
  const recoveredRunIds = new Set(
    current
      .filter((event) => event.event_type === "stale_lock_recovered")
      .map((event) => event.run_id)
  );
  const staleRunIds = new Set(
    current
      .filter((event) => event.event_type === "stale_lock_detected" && event.run_id)
      .map((event) => event.run_id)
  );
  const observedAt = new Date().toISOString();
  const terminalRuns = runs.filter((run) => (
    staleRunIds.has(run.run_id) &&
    !recoveredRunIds.has(run.run_id) &&
    (run.state === "completed" || run.state === "completed_with_lock_warning" || (run.state === "blocked" && run.result_path))
  ));

  return terminalRuns.map((run) => makeEvent({
    repoId,
    runId: run.run_id,
    eventType: "stale_lock_recovered",
    resultStatus: run.result_status ?? run.state,
    resultPath: run.result_path ?? `.chatgpt/codex-runs/${run.run_id}/RESULT.md`,
    severity: "info",
    summary: `Previously stale run ${run.run_id} now has terminal RESULT.md status ${run.result_status ?? run.state}.`,
    observedAt,
    suggestedNextAction: "review_ready_result",
    dedupeSuffix: "stale_recovered"
  }));
}

function makeEvent(input: {
  repoId: string;
  runId: string;
  eventType: BridgeEvent["event_type"];
  resultStatus: string;
  resultPath: string;
  severity: BridgeEvent["severity"];
  summary: string;
  observedAt: string;
  suggestedNextAction: string;
  dedupeSuffix?: string;
}): BridgeEvent {
  const statusKey = input.dedupeSuffix ?? input.resultStatus ?? "";
  const dedupeKey = [input.repoId, input.runId || "repo", statusKey || input.eventType].join(":");
  return {
    event_id: `${input.repoId}:${input.eventType}:${input.runId || "repo"}:${statusKey || "state"}`,
    event_type: input.eventType,
    repo_id: input.repoId,
    run_id: input.runId,
    result_status: input.resultStatus,
    result_path: input.resultPath,
    severity: input.severity,
    summary: input.summary,
    observed_at: input.observedAt,
    created_at: input.observedAt,
    suggested_next_action: input.suggestedNextAction,
    acknowledged: false,
    unread: true,
    dedupe_key: dedupeKey,
    retention_policy: `keep_last_${EVENT_RETENTION_LIMIT}`
  };
}

async function readEventLog(repoRoot: string): Promise<BridgeEvent[]> {
  try {
    const raw = await readFile(join(repoRoot, EVENT_LOG_PATH), "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as BridgeEvent)
      .filter((event) => typeof event.event_id === "string" && typeof event.dedupe_key === "string");
  } catch {
    return [];
  }
}

async function writeEventLog(repoRoot: string, events: BridgeEvent[]): Promise<void> {
  const eventPath = join(repoRoot, EVENT_LOG_PATH);
  const tmpPath = `${eventPath}.tmp`;
  await mkdir(join(repoRoot, ".chatgpt/events"), { recursive: true });
  await writeFile(tmpPath, events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : ""), "utf8");
  await rename(tmpPath, eventPath);
}

function activeRunDetails(
  heartbeatActiveRunIds: string[],
  activeLocks: Array<{
    run_id: string;
    lock_path: string;
    lock_age_seconds: number;
    runner_pid: number | null;
    child_pid?: number | null;
    worker_slot_id?: number | null;
    result_md_exists: boolean;
  }>,
  runs: ClassifiedRun[],
  heartbeat: {
    age_seconds: number | null;
    alive: boolean;
    active_run_id: string;
  }
): AgentRunnerStatusResult["active_runs"] {
  const lockIds = new Set(activeLocks.map((lock) => lock.run_id));
  const heartbeatIds = new Set(heartbeatActiveRunIds);
  const details = activeLocks.map((lock) => ({
    run_id: lock.run_id,
    source: heartbeatIds.has(lock.run_id) ? "heartbeat_and_lock" as const : "lock" as const,
    heartbeat_active: heartbeatIds.has(lock.run_id),
    lock_path: lock.lock_path,
    lock_age_seconds: lock.lock_age_seconds,
    runner_pid: lock.runner_pid,
    result_md_exists: lock.result_md_exists,
    runtime_assessment: assessRun({
      run: runs.find((run) => run.run_id === lock.run_id),
      heartbeat,
      heartbeatActive: heartbeatIds.has(lock.run_id),
      source: heartbeatIds.has(lock.run_id) ? "heartbeat_and_lock" : "lock"
    })
  }));

  for (const heartbeatActiveRunId of heartbeatActiveRunIds.filter((id) => !lockIds.has(id))) {
    const heartbeatRun = runs.find((run) => run.run_id === heartbeatActiveRunId);
    details.unshift({
      run_id: heartbeatActiveRunId,
      source: "heartbeat",
      heartbeat_active: true,
      lock_path: "",
      lock_age_seconds: null,
      runner_pid: null,
      result_md_exists: heartbeatRun?.state === "completed" || heartbeatRun?.state === "blocked",
      runtime_assessment: assessRun({
        run: heartbeatRun,
        heartbeat,
        heartbeatActive: true,
        source: "heartbeat"
      })
    });
  }

  return details;
}

function assessRun(input: {
  run?: ClassifiedRun;
  heartbeat: { age_seconds: number | null; alive: boolean; active_run_id: string };
  heartbeatActive: boolean;
  source: "heartbeat" | "lock" | "heartbeat_and_lock";
}): AgentRunnerStatusResult["active_runs"][number]["runtime_assessment"] {
  const lockAge = input.run?.lock_age_seconds ?? null;
  const pidPresent = typeof input.run?.runner_pid === "number";
  const resultExists = input.run?.result_md_exists ?? (input.run?.state === "completed" || input.run?.state === "blocked");
  const recentFileAge = input.run?.run_dir_recent_mtime_ms ? Math.max(0, (Date.now() - input.run.run_dir_recent_mtime_ms) / 1000) : null;
  const processMatch = pidPresent ? "pid_alive_or_current" : "not_detected";
  const evidence = {
    heartbeat_age_seconds: input.heartbeat.age_seconds,
    lock_age_seconds: lockAge,
    pid_present: pidPresent,
    result_md_exists: resultExists,
    recent_file_modification_age_seconds: recentFileAge,
    recent_log_growth: "not_checked",
    process_match: processMatch
  };

  if (input.run?.state === "stale_locked") {
    return {
      state: "stale",
      confidence: "high",
      stall_risk: "high",
      abandonment_risk: "high",
      evidence,
      summary: "The run has a stale lock based on observable lock age or dead PID evidence."
    };
  }
  if (input.run?.state === "blocked") {
    return {
      state: "failed",
      confidence: "high",
      stall_risk: "high",
      abandonment_risk: "high",
      evidence,
      summary: "The run has a blocked RESULT.md or incomplete metadata."
    };
  }
  if (input.heartbeat.alive && input.heartbeatActive && pidPresent && lockAge !== null && lockAge < 300) {
    return {
      state: "healthy",
      confidence: "high",
      stall_risk: "low",
      abandonment_risk: "low",
      evidence,
      summary: "Fresh heartbeat, active lock, and recorded PID indicate the run is probably progressing."
    };
  }
  if (input.heartbeat.alive && input.heartbeatActive && lockAge !== null && lockAge < 300) {
    return {
      state: "uncertain",
      confidence: "medium",
      stall_risk: "medium",
      abandonment_risk: "medium",
      evidence,
      summary: "The heartbeat and lock are fresh, but no runner PID is recorded in the lock."
    };
  }
  if (lockAge !== null && lockAge >= 300) {
    return {
      state: "stuck",
      confidence: "medium",
      stall_risk: "high",
      abandonment_risk: "medium",
      evidence,
      summary: "The lock is old enough to carry elevated stall risk, but the stale threshold has not necessarily been crossed."
    };
  }
  return {
    state: "uncertain",
    confidence: "low",
    stall_risk: "medium",
    abandonment_risk: "medium",
    evidence,
    summary: "Available heartbeat and lock evidence is insufficient to prove the run is progressing."
  };
}

async function newestRunDirectoryMtimeMs(runDir: string): Promise<number | null> {
  try {
    const entries = await readdir(runDir);
    const mtimes = await Promise.all(entries.map(async (entry) => {
      try {
        return (await stat(join(runDir, entry))).mtimeMs;
      } catch {
        return 0;
      }
    }));
    return Math.max(...mtimes, 0) || null;
  } catch {
    return null;
  }
}

function assessRuntime(
  runnerState: AgentRunnerStatusResult["runner_state"],
  heartbeatStatus: string,
  counts: Record<ClassifiedRun["state"], number>,
  activeRunCount: number
): AgentRunnerStatusResult["runtime_assessment"] {
  if (activeRunCount > 0 || heartbeatStatus === "running") {
    return "running_active_run";
  }
  if (runnerState === "dead") {
    return "offline";
  }
  if (runnerState === "stale" || counts.stale_locked > 0) {
    return "attention_needed";
  }
  return "idle";
}

function extractUrls(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  return [...new Set(urls.map((url) => url.replace(/[.,;:]+$/g, "")))];
}

function tail(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(value.length - limit);
}
