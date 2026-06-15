import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  recordConnectorRequestOutcome,
  resetConnectorDiagnosticsForTests
} from "../src/runtime/connector-session.js";
import { AgentRunnerStatusService } from "../src/services/agent-runner-status-service.js";

describe("AgentRunnerStatusService", () => {
  test("reports connector/session degradation separately from runner health", async () => {
    resetConnectorDiagnosticsForTests();
    recordConnectorRequestOutcome({
      ok: false,
      tool: "repo_write_codex_task",
      error_kind: "session_terminated",
      occurred_at: "2026-06-07T20:45:00.000Z"
    });
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-connector-"));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "polling",
      active_run_id: "",
      runner: "projects/agent-runner/agent_runner.py",
      pid: process.pid
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.runner).toBe("alive");
    expect(status.worker).toBe("running");
    expect(status.connector_status).toBe("degraded");
    expect(status.last_connector_error_kind).toBe("session_terminated");
    expect(status.last_failed_tool_call).toBe("repo_write_codex_task");
    expect(status.suspected_cause).toContain("connector/session");
    expect(status.suggested_next_action).toContain("refresh connector");
    expect(status.plain_text).toContain("Connector: degraded");
    resetConnectorDiagnosticsForTests();
  });

  test("returns plain text and structured runner status without launching processes", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-"));
    await writeRun(root, "2026-06-07T063000Z-pending", false);
    await writeRun(root, "2026-06-07T063000Z-completed", true);
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "polling",
      active_run_id: "",
      runner: "projects/agent-runner/agent_runner.py",
      pid: 1234
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.ok).toBe(true);
    expect(status.runner_state).toBe("alive");
    expect(status.runner).toBe("alive");
    expect(status.worker).toBe("running");
    expect(status.pending_count).toBe(1);
    expect(status.completed_count).toBe(1);
    expect(status.active_count).toBe(0);
    expect(status.stale_lock_count).toBe(0);
    expect(status.queue_entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        run_id: "2026-06-07T063000Z-pending",
        state: "pending",
        prompt_path: ".chatgpt/codex-runs/2026-06-07T063000Z-pending/PROMPT.md",
        result_path: ".chatgpt/codex-runs/2026-06-07T063000Z-pending/RESULT.md",
        result_md_exists: false,
        terminal: false
      }),
      expect.objectContaining({
        run_id: "2026-06-07T063000Z-completed",
        state: "completed",
        result_status: "completed",
        result_md_exists: true,
        terminal: true
      })
    ]));
    expect(status.last_run_id).toBe("2026-06-07T063000Z-completed");
    expect(status.last_run_status).toBe("completed");
    expect(status.plain_text).toContain("Runner: alive");
    expect(status.plain_text).toContain("Pending: 1");
    expect(status.plain_text).toContain("Last run: 2026-06-07T063000Z-completed; status: completed");
  });

  test("classifies locks with dead runner pid as stale instead of active", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-dead-pid-"));
    const runId = "2026-06-07T000000Z-runner-status-check";
    await writeRun(root, runId, false);
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "RESULT.md.lock"), JSON.stringify({
      runner_pid: 99999999
    }));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "running",
      active_run_id: runId
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.active_count).toBe(0);
    expect(status.stale_lock_count).toBe(1);
    expect(status.active_run_id).toBe("");
    expect(status.plain_text).toContain("Active: 0");
    expect(status.plain_text).toContain("Stale locks: 1");
  });

  test("returns newest completed result text and preview urls for ChatGPT handoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-ready-result-"));
    const productRun = "2026-06-07T071500Z-tiny-product-loop-test";
    const maintenanceRun = "2026-06-07T072500Z-clear-ghost-runner-status-check";
    await writeRun(root, productRun, true, [
      "# CODEX_RESULT",
      "status: completed",
      "summary: Built the Coffee Shade Picker.",
      "Phone URL: http://desktop-bqnfjch.tail0eaf06.ts.net:8083/",
      "Local URL: http://127.0.0.1:8083/"
    ].join("\n"));
    await writeRun(root, maintenanceRun, true, "# CODEX_RESULT\nstatus: completed\nsummary: Maintenance cleanup.\n");
    const productResultPath = join(root, ".chatgpt/codex-runs", productRun, "RESULT.md");
    const maintenanceResultPath = join(root, ".chatgpt/codex-runs", maintenanceRun, "RESULT.md");
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);
    await utimes(maintenanceResultPath, earlier, earlier);
    await utimes(productResultPath, now, now);
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "polling",
      active_run_id: ""
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.ready_results[0]).toMatchObject({
      run_id: productRun,
      result_path: `.chatgpt/codex-runs/${productRun}/RESULT.md`
    });
    expect(status.ready_results[0]?.result_text).toContain("Built the Coffee Shade Picker");
    expect(status.ready_results[0]?.preview_urls).toContain("http://desktop-bqnfjch.tail0eaf06.ts.net:8083/");
    expect(status.plain_text).toContain(`Ready result: ${productRun}`);
    expect(status.plain_text).toContain("Preview URL: http://desktop-bqnfjch.tail0eaf06.ts.net:8083/");
  });

  test("defaults to compact status payload while preserving full detail on request", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-compact-"));
    const runId = "2026-06-07T081500Z-large-result";
    const longBody = "FULL_DETAIL_MARKER ".repeat(1200);
    await writeRun(root, runId, true, [
      "# CODEX_RESULT",
      "status: completed",
      "summary: Large result finished.",
      longBody
    ].join("\n"));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "polling",
      active_run_id: ""
    }));

    const compact = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900
    });
    const full = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(compact.detail_level).toBe("summary");
    expect(compact.details_truncated).toBe(true);
    expect(compact.full_detail_hint).toContain("detail: \"full\"");
    expect(compact.ready_results[0]?.result_text).toBe("");
    expect(compact.ready_results[0]?.result_text).not.toContain("FULL_DETAIL_MARKER FULL_DETAIL_MARKER FULL_DETAIL_MARKER");
    expect(compact.queue_entries).toHaveLength(0);
    expect(compact.worker_slots).toHaveLength(0);
    expect(compact.recent_events).toHaveLength(0);
    expect(compact.plain_text).not.toContain(`Ready result ids: ${runId}`);
    expect(compact.plain_text).not.toContain("Completed:");
    expect(compact.plain_text).not.toContain("Blocked:");
    expect(compact.plain_text).not.toContain("Last run:");
    expect(compact.plain_text).toContain("request detail: \"full\" for historical counts");
    expect(full.detail_level).toBe("full");
    expect(full.details_truncated).toBe(false);
    expect(full.ready_results[0]?.result_text).toContain("FULL_DETAIL_MARKER FULL_DETAIL_MARKER FULL_DETAIL_MARKER");
  });

  test("returns blocked result text for ChatGPT handoff when a run writes blocked RESULT.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-blocked-result-"));
    const blockedRun = "2026-06-07T175000Z-image-analysis-routing-test";
    await writeRun(root, blockedRun, true, [
      "# CODEX_RESULT",
      "status: blocked",
      "summary: No Google/Gemma/Gemini image-analysis route was available.",
      "blockers:",
      "- image file was not accessible to Codex",
      "- no Gemini API configuration was present"
    ].join("\n"));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "polling",
      active_run_id: ""
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.blocked_count).toBe(1);
    expect(status.ready_results[0]).toMatchObject({
      run_id: blockedRun,
      result_path: `.chatgpt/codex-runs/${blockedRun}/RESULT.md`,
      result_status: "blocked"
    });
    expect(status.ready_results[0]?.result_text).toContain("No Google/Gemma/Gemini image-analysis route was available");
    expect(status.plain_text).toContain(`Ready result: ${blockedRun}`);
    expect(status.plain_text).toContain("Ready result status: blocked");
    expect(status.queue_entries).toEqual([
      expect.objectContaining({
        run_id: blockedRun,
        state: "blocked",
        result_status: "blocked",
        result_md_exists: true,
        terminal: true
      })
    ]);
  });

  test("does not mark idle runtime attention_needed for historical terminal blocked results", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-blocked-history-"));
    const blockedRun = "2026-06-07T175000Z-image-analysis-routing-test";
    await writeRun(root, blockedRun, true, [
      "# CODEX_RESULT",
      "status: blocked",
      "summary: Historical blocked result that remains reviewable."
    ].join("\n"));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "polling",
      active_run_id: ""
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.runner_state).toBe("alive");
    expect(status.pending_count).toBe(0);
    expect(status.active_count).toBe(0);
    expect(status.stale_lock_count).toBe(0);
    expect(status.blocked_count).toBe(1);
    expect(status.runtime_assessment).toBe("idle");
    expect(status.plain_text).toContain("Runtime assessment: idle");
  });

  test("reports active locks active runs and runtime assessment without launching processes", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-runtime-"));
    const activeRunId = "2026-06-07T090000Z-restore-runner-status-observability";
    await writeRun(root, activeRunId, false);
    await writeFile(join(root, ".chatgpt/codex-runs", activeRunId, "RESULT.md.lock"), JSON.stringify({
      runner_pid: process.pid,
      run_id: activeRunId
    }));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "running",
      active_run_id: activeRunId,
      runner: "projects/agent-runner/agent_runner.py",
      pid: process.pid
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.runtime_assessment).toBe("running_active_run");
    expect(status.active_run_ids).toEqual([activeRunId]);
    expect(status.active_locks).toEqual([
      expect.objectContaining({
        run_id: activeRunId,
        lock_path: `.chatgpt/codex-runs/${activeRunId}/RESULT.md.lock`,
        runner_pid: process.pid,
        result_md_exists: false
      })
    ]);
    expect(status.active_runs).toEqual([
      expect.objectContaining({
        run_id: activeRunId,
        source: "heartbeat_and_lock",
        heartbeat_active: true,
        runtime_assessment: expect.objectContaining({
          state: "healthy",
          confidence: "high",
          stall_risk: "low",
          abandonment_risk: "low",
          evidence: expect.objectContaining({
            pid_present: true,
            result_md_exists: false
          }),
          summary: expect.stringContaining("heartbeat")
        })
      })
    ]);
    expect(status.plain_text).toContain("Runtime assessment: running_active_run");
    expect(status.plain_text).toContain(`Active run: ${activeRunId}; source: heartbeat_and_lock`);
  });

  test("reports multiple active runs with worker slots capacity and separated live tails", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-parallel-"));
    const firstRun = "2026-06-08T031500Z-parallel-canary-a";
    const secondRun = "2026-06-08T031501Z-parallel-canary-b";
    const pendingRun = "2026-06-08T031502Z-parallel-canary-c";
    await writeRun(root, firstRun, false);
    await writeRun(root, secondRun, false);
    await writeRun(root, pendingRun, false);
    await writeFile(join(root, ".chatgpt/codex-runs", firstRun, "RESULT.md.lock"), JSON.stringify({
      runner_pid: process.pid,
      child_pid: 8001,
      worker_slot_id: 1,
      run_id: firstRun
    }));
    await writeFile(join(root, ".chatgpt/codex-runs", secondRun, "RESULT.md.lock"), JSON.stringify({
      runner_pid: process.pid,
      child_pid: 8002,
      worker_slot_id: 2,
      run_id: secondRun
    }));
    await writeFile(join(root, ".chatgpt/codex-runs", firstRun, "events.jsonl"), [
      JSON.stringify({ timestamp: "2026-06-08T03:15:01Z", event_type: "run_claimed", summary: "first claimed" })
    ].join("\n") + "\n");
    await writeFile(join(root, ".chatgpt/codex-runs", secondRun, "events.jsonl"), [
      JSON.stringify({ timestamp: "2026-06-08T03:15:02Z", event_type: "run_claimed", summary: "second claimed" })
    ].join("\n") + "\n");
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "running",
      active_run_id: firstRun,
      active_run_ids: [firstRun, secondRun],
      max_parallel_runs: 2,
      worker_slots: [
        { slot_id: 1, state: "active", run_id: firstRun, pid: 8001, started_at: "2026-06-08T03:15:00Z" },
        { slot_id: 2, state: "active", run_id: secondRun, pid: 8002, started_at: "2026-06-08T03:15:01Z" }
      ],
      runner: "projects/agent-runner/agent_runner.py",
      pid: process.pid
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.active_count).toBe(2);
    expect(status.pending_count).toBe(1);
    expect(status.active_run_ids).toEqual([firstRun, secondRun]);
    expect(status.max_parallel_runs).toBe(2);
    expect(status.worker_slot_count).toBe(2);
    expect(status.active_worker_slots).toBe(2);
    expect(status.idle_worker_slots).toBe(0);
    expect(status.queued_because_at_capacity).toBe(true);
    expect(status.worker_slots).toEqual([
      expect.objectContaining({ slot_id: 1, state: "active", run_id: firstRun, pid: 8001 }),
      expect.objectContaining({ slot_id: 2, state: "active", run_id: secondRun, pid: 8002 })
    ]);
    expect(status.active_runs).toEqual([
      expect.objectContaining({ run_id: firstRun, source: "heartbeat_and_lock", heartbeat_active: true }),
      expect.objectContaining({ run_id: secondRun, source: "heartbeat_and_lock", heartbeat_active: true })
    ]);
    expect(status.active_run_live_tail).toEqual([
      expect.objectContaining({ run_id: firstRun, event_type: "run_claimed", summary: "first claimed" }),
      expect.objectContaining({ run_id: secondRun, event_type: "run_claimed", summary: "second claimed" })
    ]);
    expect(status.plain_text).toContain("Worker slots: 2 active / 0 idle");
    expect(status.plain_text).toContain("Queued because at capacity: yes");
    expect(status.plain_text).toContain(`Live tail for ${firstRun}:`);
    expect(status.plain_text).toContain(`Live tail for ${secondRun}:`);
  });

  test("surfaces worker progress envelopes through runner status without arbitrary fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-progress-envelope-"));
    const runId = "2026-06-11T180716Z-progress-envelope";
    await writeRun(root, runId, false);
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "RESULT.md.lock"), JSON.stringify({
      runner_pid: process.pid,
      child_pid: 8101,
      worker_slot_id: 1,
      run_id: runId
    }));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "running",
      active_run_id: runId,
      active_run_ids: [runId],
      max_parallel_runs: 1,
      worker_slots: [
        {
          slot_id: 1,
          state: "active",
          run_id: runId,
          pid: 8101,
          started_at: "2026-06-11T18:30:00Z",
          progress: {
            schema_version: 1,
            phase: "verifying",
            percent_complete: 75,
            eta: "2026-06-11T18:50:00Z",
            confidence: "high",
            current_activity: "Running focused tests.",
            next_checkpoint: "Write RESULT.md.",
            private_token: "SHOULD_NOT_APPEAR"
          }
        }
      ],
      runner: "projects/agent-runner/agent_runner.py",
      pid: process.pid
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.worker_slots[0]).toMatchObject({
      slot_id: 1,
      run_id: runId,
      progress: {
        schema_version: 1,
        phase: "verifying",
        percent_complete: 75,
        eta: "2026-06-11T18:50:00Z",
        confidence: "high",
        current_activity: "Running focused tests.",
        next_checkpoint: "Write RESULT.md."
      }
    });
    expect(status.plain_text).toContain(`Progress: ${runId}; phase: verifying; percent: 75%; eta: 2026-06-11T18:50:00Z; confidence: high`);
    expect(JSON.stringify(status.worker_slots)).not.toContain("SHOULD_NOT_APPEAR");
  });

  test("reports no heartbeat as unknown worker with missing heartbeat warning", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-no-heartbeat-"));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900
    });

    expect(status.runner).toBe("unknown");
    expect(status.worker).toBe("unknown");
    expect(status.heartbeat_status).toBe("missing");
    expect(status.warnings).toContain("AGENT_RUNNER_HEARTBEAT_MISSING");
  });

  test("reports stale heartbeat as stale runner and not running worker", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-stale-heartbeat-"));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date(Date.now() - 120_000).toISOString(),
      status: "polling",
      active_run_id: ""
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900
    });

    expect(status.runner).toBe("stale");
    expect(status.worker).toBe("not_running");
    expect(status.warnings).toContain("AGENT_RUNNER_NOT_ALIVE");
  });

  test("reports active lock without pid as uncertain with explicit warning", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-lock-no-pid-"));
    const runId = "2026-06-07T091500Z-active-without-pid";
    await writeRun(root, runId, false);
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "RESULT.md.lock"), JSON.stringify({
      run_id: runId
    }));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "running",
      active_run_id: runId
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900
    });

    expect(status.active_count).toBe(1);
    expect(status.warnings).toContain("ACTIVE_LOCK_PID_MISSING");
    expect(status.active_runs[0]?.runtime_assessment).toMatchObject({
      state: "uncertain",
      confidence: "medium",
      stall_risk: "medium",
      abandonment_risk: "medium"
    });
  });

  test("includes safe live tail events for active run status", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-live-tail-status-"));
    const runId = "2026-06-07T120000Z-active-live-tail";
    await writeRun(root, runId, false);
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "RESULT.md.lock"), JSON.stringify({
      runner_pid: process.pid,
      run_id: runId
    }));
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "events.jsonl"), [
      JSON.stringify({ timestamp: "2026-06-07T12:00:01Z", event_type: "run_claimed", summary: "Run claimed with Authorization: Bearer abc123" }),
      JSON.stringify({ timestamp: "2026-06-07T12:00:02Z", event_type: "prompt_loaded", summary: "Prompt loaded", path: `.chatgpt/codex-runs/${runId}/PROMPT.md` })
    ].join("\n") + "\n");
    await mkdir(join(root, "projects/agent-runner/reports/codex-exec", runId), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/codex-exec", runId, "events.jsonl"), [
      JSON.stringify({ timestamp: "2026-06-07T12:00:03Z", event_type: "codex_stdout", summary: "stdout line token=abc123", source_stream: "codex_stdout" }),
      JSON.stringify({ timestamp: "2026-06-07T12:00:04Z", event_type: "codex_stderr", summary: "stderr line secret=hide", source_stream: "codex_stderr" })
    ].join("\n") + "\n");
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "running",
      active_run_id: runId,
      runner: "projects/agent-runner/agent_runner.py",
      pid: process.pid
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.active_run_live_tail).toEqual([
      expect.objectContaining({
        sequence: 1,
        event_type: "run_claimed",
        summary: expect.stringContaining("Authorization=[REDACTED]")
      }),
      expect.objectContaining({
        sequence: 2,
        event_type: "prompt_loaded",
        path: `.chatgpt/codex-runs/${runId}/PROMPT.md`
      }),
      expect.objectContaining({
        sequence: 3,
        event_type: "codex_stdout",
        summary: expect.stringContaining("stdout line")
      }),
      expect.objectContaining({
        sequence: 4,
        event_type: "codex_stderr",
        summary: expect.stringContaining("stderr line")
      })
    ]);
    expect(status.active_run_live_tail.map((event) => event.summary).join("\n")).not.toContain("abc123");
    expect(status.active_run_live_tail.map((event) => event.summary).join("\n")).not.toContain("hide");
    expect(status.plain_text).toContain("Live tail for 2026-06-07T120000Z-active-live-tail:");
    expect(status.plain_text).toContain("1 run_claimed: Run claimed with Authorization=[REDACTED]");
    expect(status.plain_text).toContain("2 prompt_loaded: Prompt loaded");
    expect(status.plain_text).toContain("3 codex_stdout: stdout line");
    expect(status.plain_text).toContain("4 codex_stderr: stderr line");
  });

  test("polls active runner status internally and returns compact live-tail deltas", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-polling-"));
    const runId = "2026-06-08T023500Z-live-tail-polling-mode";
    await writeRun(root, runId, false);
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "RESULT.md.lock"), JSON.stringify({
      runner_pid: process.pid,
      run_id: runId
    }));
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "events.jsonl"), [
      JSON.stringify({ timestamp: "2026-06-08T02:35:01Z", event_type: "run_claimed", summary: "Run claimed" }),
      JSON.stringify({ timestamp: "2026-06-08T02:35:02Z", event_type: "prompt_loaded", summary: "Prompt loaded" })
    ].join("\n") + "\n");
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "running",
      active_run_id: runId,
      runner: "projects/agent-runner/agent_runner.py",
      pid: process.pid
    }));
    const sleeps: number[] = [];
    const service = new AgentRunnerStatusService(root, {
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds);
      }
    });

    const status = await service.status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      live_tail_max_events: 10,
      poll_count: 2,
      poll_interval_seconds: 5,
      detail: "full"
    });

    expect(sleeps).toEqual([5000]);
    expect(status.poll_count).toBe(2);
    expect(status.poll_interval_seconds).toBe(5);
    expect(status.monitoring_stop_reason).toBe("poll_count_reached");
    expect(status.poll_history).toEqual([
      expect.objectContaining({
        poll_index: 1,
        observed_at: expect.any(String),
        heartbeat_updated_at: expect.any(String),
        heartbeat_age_seconds: expect.any(Number),
        event_count: expect.any(Number),
        event_cursor: expect.any(String),
        active_count: 1,
        active_run_id: runId,
        last_run_status: "active",
        result_md_exists: false,
        preview_urls: [],
        live_tail_events: [
          expect.objectContaining({ event_type: "run_claimed" }),
          expect.objectContaining({ event_type: "prompt_loaded" })
        ]
      }),
      expect.objectContaining({
        poll_index: 2,
        active_count: 1,
        active_run_id: runId,
        result_md_exists: false,
        preview_urls: [],
        live_tail_events: []
      })
    ]);
    expect(status.plain_text).toContain("Monitoring polls: 2; stop reason: poll_count_reached");
  });

  test("repo live tail reads events with cursor and redacts sensitive output tails", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-live-tail-tool-"));
    const runId = "2026-06-07T121500Z-live-tail-tool";
    await writeRun(root, runId, false);
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "events.jsonl"), [
      JSON.stringify({ timestamp: "2026-06-07T12:15:01Z", event_type: "run_claimed", summary: "token=abc123" }),
      JSON.stringify({ timestamp: "2026-06-07T12:15:02Z", event_type: "codex_process_started", summary: "Codex started" })
    ].join("\n") + "\n");
    await mkdir(join(root, "projects/agent-runner/reports/codex-exec", runId), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/codex-exec", runId, "stderr.log"), "session_id=abcdef1234567890abcdef1234567890 Authorization: Bearer xyz\ncommand finished\n");

    const tail = await new AgentRunnerStatusService(root).liveTail({
      repo_id: "fixture",
      run_id: runId,
      cursor: "1",
      max_events: 10
    });

    expect(tail.ok).toBe(true);
    expect(tail.events[0]?.sequence).toBe(2);
    expect(tail.events.map((event) => event.event_type)).toContain("command_output_tail");
    expect(JSON.stringify(tail.events)).not.toContain("abc123");
    expect(JSON.stringify(tail.events)).not.toContain("Bearer xyz");
    expect(tail.next_cursor).toBe(String(tail.events.at(-1)?.sequence));
    expect(tail.terminal).toBe(false);
  });

  test("reports stale lock runtime assessment as stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-stale-lock-"));
    const runId = "2026-06-07T092000Z-stale-lock";
    await writeRun(root, runId, false);
    const lockPath = join(root, ".chatgpt/codex-runs", runId, "RESULT.md.lock");
    await writeFile(lockPath, JSON.stringify({ run_id: runId }));
    const old = new Date(Date.now() - 120_000);
    await utimes(lockPath, old, old);

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 60,
      detail: "full"
    });

    expect(status.stale_lock_count).toBe(1);
    expect(status.stale_locks[0]?.runtime_assessment).toMatchObject({
      state: "stale",
      confidence: "high",
      stall_risk: "high",
      abandonment_risk: "high"
    });
    expect(status.stale_locks[0]).toMatchObject({
      stale_reason: "lock_age_exceeded",
      pid_status: "missing",
      suggested_next_action: "write_blocked_result_and_clear_abandoned_lock",
      recovery_policy: "blocked_result_then_clear_abandoned_lock",
      recovery_safe: true,
      result_conversion_status: "pending_blocked_result_conversion"
    });
    expect(status.recent_events).toEqual([
      expect.objectContaining({
        event_type: "stale_lock_detected",
        run_id: runId,
        severity: "warning",
        suggested_next_action: "write_blocked_result_and_clear_abandoned_lock"
      })
    ]);
  });

  test("persists completed and blocked run events with required ChatGPT fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-event-inbox-"));
    const completedRun = "2026-06-07T200001Z-completed";
    const blockedRun = "2026-06-07T200002Z-blocked";
    await writeRun(root, completedRun, true, "# CODEX_RESULT\nstatus: completed\nsummary: Done.\n");
    await writeRun(root, blockedRun, true, "# CODEX_RESULT\nstatus: blocked\nsummary: Blocked.\n");
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "polling",
      active_run_id: ""
    }));

    const service = new AgentRunnerStatusService(root);
    const first = await service.status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });
    const second = await service.status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(first.event_log_path).toBe(".chatgpt/events/bridge-events.jsonl");
    expect(first.event_cursor).toEqual(expect.any(String));
    expect(first.event_count).toBeGreaterThanOrEqual(2);
    expect(first.unresolved_event_count).toBeGreaterThanOrEqual(2);
    expect(first.acknowledgement_policy).toContain("status reads do not acknowledge events");
    expect(first.unresolved_events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_id: expect.any(String),
        event_type: "run_completed",
        repo_id: "fixture",
        run_id: completedRun,
        result_status: "completed",
        result_path: `.chatgpt/codex-runs/${completedRun}/RESULT.md`,
        summary: expect.stringContaining("wrote RESULT.md"),
        severity: "info",
        observed_at: expect.any(String),
        acknowledged: false,
        dedupe_key: `fixture:${completedRun}:completed`,
        suggested_next_action: "review_ready_result"
      }),
      expect.objectContaining({
        event_id: expect.any(String),
        event_type: "run_blocked",
        repo_id: "fixture",
        run_id: blockedRun,
        result_status: "blocked",
        result_path: `.chatgpt/codex-runs/${blockedRun}/RESULT.md`,
        summary: expect.stringContaining("wrote RESULT.md"),
        severity: "warning",
        observed_at: expect.any(String),
        acknowledged: false,
        dedupe_key: `fixture:${blockedRun}:blocked`,
        suggested_next_action: "review_ready_result"
      })
    ]));
    expect(second.unresolved_events.map((event) => event.event_id).sort()).toEqual(
      first.unresolved_events.map((event) => event.event_id).sort()
    );
    const jsonl = await readFile(join(root, ".chatgpt/events/bridge-events.jsonl"), "utf8");
    const rows = jsonl.trim().split(/\r?\n/).map((line) => JSON.parse(line) as { event_id: string });
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(rows.length);
  });

  test("keeps acknowledged events out of unresolved_events while preserving cursor counts", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-ack-"));
    await mkdir(join(root, ".chatgpt/events"), { recursive: true });
    await writeFile(join(root, ".chatgpt/events/bridge-events.jsonl"), JSON.stringify({
      event_id: "fixture:run_completed:old:completed",
      event_type: "run_completed",
      repo_id: "fixture",
      run_id: "old",
      result_status: "completed",
      result_path: ".chatgpt/codex-runs/old/RESULT.md",
      severity: "info",
      summary: "Old acknowledged event.",
      observed_at: "2026-06-07T00:00:00.000Z",
      created_at: "2026-06-07T00:00:00.000Z",
      suggested_next_action: "review_ready_result",
      acknowledged: true,
      unread: false,
      dedupe_key: "fixture:old:completed",
      retention_policy: "keep_last_500"
    }) + "\n");
    const completedRun = "2026-06-07T200003Z-new-completed";
    await writeRun(root, completedRun, true, "# CODEX_RESULT\nstatus: completed\nsummary: Done.\n");
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "polling",
      active_run_id: ""
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.event_count).toBeGreaterThanOrEqual(2);
    expect(status.unresolved_events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ run_id: "old" })
    ]));
    expect(status.unresolved_events).toEqual(expect.arrayContaining([
      expect.objectContaining({ run_id: completedRun, acknowledged: false, unread: true })
    ]));
    expect(status.unresolved_event_count).toBe(status.unresolved_events.length);
    expect(status.event_cursor).toBe(status.recent_events[0]?.event_id);
  });

  test("summarizes long structured live-tail bodies without exposing full body by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-live-tail-summary-"));
    const runId = "2026-06-11T110000Z-long-structured-event";
    await writeRun(root, runId, false);
    await mkdir(join(root, ".chatgpt/codex-runs", runId), { recursive: true });
    const longBody = {
      id: "dropoff-123",
      area: "kitchen",
      state: "ready",
      result: "validator contract drafted for review",
      body: "FULL_BODY_SHOULD_NOT_APPEAR ".repeat(80),
      details: {
        nested: "NESTED_FULL_BODY_SHOULD_NOT_APPEAR ".repeat(30)
      }
    };
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "events.jsonl"), JSON.stringify({
      timestamp: "2026-06-11T11:00:00.000Z",
      event_type: "work_dropoff",
      body: longBody
    }) + "\n");

    const service = new AgentRunnerStatusService(root);
    const tail = await service.liveTail({
      repo_id: "fixture",
      run_id: runId,
      max_events: 10
    });

    expect(tail.events[0]).toMatchObject({
      event_type: "work_dropoff",
      summary: "id=dropoff-123; area=kitchen; state=ready; result=validator contract drafted for review"
    });
    expect(JSON.stringify(tail.events)).not.toContain("FULL_BODY_SHOULD_NOT_APPEAR");
    expect(JSON.stringify(tail.events)).not.toContain("NESTED_FULL_BODY_SHOULD_NOT_APPEAR");
  });

  test("default status plain text summarizes structured live-tail bodies compactly", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-compact-live-tail-"));
    const runId = "2026-06-11T111500Z-active-structured-event";
    await writeRun(root, runId, false);
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "RESULT.md.lock"), JSON.stringify({
      runner_pid: process.pid,
      run_id: runId
    }));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "running",
      active_run_id: runId,
      active_run_ids: [runId],
      runner: "projects/agent-runner/agent_runner.py",
      pid: process.pid
    }));
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "events.jsonl"), JSON.stringify({
      timestamp: "2026-06-11T11:15:00.000Z",
      event_type: "bounded_work_dropoff",
      body: {
        id: "slice-456",
        area: "status-surface",
        state: "queued",
        result: "compact reporting note prepared",
        payload: "STATUS_FULL_BODY_SHOULD_NOT_APPEAR ".repeat(100)
      }
    }) + "\n");

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900
    });

    expect(status.plain_text).toContain("Live tail: 1 events available");
    expect(status.active_run_live_tail).toEqual([]);
    expect(JSON.stringify(status.active_run_live_tail)).not.toContain("STATUS_FULL_BODY_SHOULD_NOT_APPEAR");
    expect(status.pending_count).toBe(0);
    expect(status.active_count).toBe(1);
    expect(status.completed_count).toBe(0);
    expect(status.blocked_count).toBe(0);
    expect(status.stale_lock_count).toBe(0);

    const full = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });
    expect(full.active_run_live_tail[0]).toMatchObject({
      event_type: "bounded_work_dropoff",
      summary: "id=slice-456; area=status-surface; state=queued; result=compact reporting note prepared"
    });
    expect(JSON.stringify(full.active_run_live_tail)).not.toContain("STATUS_FULL_BODY_SHOULD_NOT_APPEAR");
  });

  test("emits stale_lock_recovered when a previously stale run becomes terminal", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-stale-recovered-"));
    const runId = "2026-06-07T200004Z-stale-then-blocked";
    await mkdir(join(root, ".chatgpt/events"), { recursive: true });
    await writeFile(join(root, ".chatgpt/events/bridge-events.jsonl"), JSON.stringify({
      event_id: `fixture:stale_lock_detected:${runId}:lock_age_exceeded`,
      event_type: "stale_lock_detected",
      repo_id: "fixture",
      run_id: runId,
      result_status: "",
      result_path: `.chatgpt/codex-runs/${runId}/RESULT.md`,
      severity: "warning",
      summary: "Stale lock detected.",
      observed_at: "2026-06-07T00:00:00.000Z",
      created_at: "2026-06-07T00:00:00.000Z",
      suggested_next_action: "write_blocked_result_and_clear_abandoned_lock",
      acknowledged: false,
      unread: true,
      dedupe_key: `fixture:${runId}:lock_age_exceeded`,
      retention_policy: "keep_last_500"
    }) + "\n");
    await writeRun(root, runId, true, "# CODEX_RESULT\nstatus: blocked\nsummary: Recovered stale lock.\n");
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "polling",
      active_run_id: ""
    }));

    const service = new AgentRunnerStatusService(root);
    const first = await service.status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });
    const second = await service.status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(first.unresolved_events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: "stale_lock_recovered",
        run_id: runId,
        result_status: "blocked",
        result_path: `.chatgpt/codex-runs/${runId}/RESULT.md`,
        severity: "info",
        suggested_next_action: "review_ready_result",
        dedupe_key: `fixture:${runId}:stale_recovered`
      })
    ]));
    expect(second.unresolved_events.filter((event) => event.event_type === "stale_lock_recovered" && event.run_id === runId)).toHaveLength(1);
  });

  test("reports dead runner pid as stale runner with suggested recovery action", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-dead-runner-pid-"));
    const runId = "2026-06-07T191500Z-minimal-capability-surface";
    await writeRun(root, runId, false);
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "RESULT.md.lock"), JSON.stringify({
      runner_pid: 99999999,
      run_id: runId
    }));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "running",
      active_run_id: runId,
      pid: 99999999
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.runner).toBe("stale");
    expect(status.worker).toBe("not_running");
    expect(status.stale_locks[0]).toMatchObject({
      run_id: runId,
      stale_reason: "dead_pid",
      pid_status: "dead",
      suggested_next_action: "write_blocked_result_and_clear_abandoned_lock",
      recovery_policy: "blocked_result_then_clear_abandoned_lock",
      recovery_safe: true,
      result_conversion_status: "pending_blocked_result_conversion"
    });
    expect(status.warnings).toContain("AGENT_RUNNER_PID_DEAD");
    expect(status.plain_text).toContain(`Stale run: ${runId}; reason: dead_pid; pid_status: dead`);
  });

  test("reports completed run with leftover lock as completed_with_lock_warning", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runner-status-completed-lock-"));
    const runId = "2026-06-07T093000Z-completed-with-lock";
    await writeRun(root, runId, true, "# CODEX_RESULT\nstatus: completed\nsummary: Done.\n");
    await writeFile(join(root, ".chatgpt/codex-runs", runId, "RESULT.md.lock"), JSON.stringify({
      runner_pid: process.pid,
      run_id: runId
    }));
    await mkdir(join(root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "polling",
      active_run_id: ""
    }));

    const status = await new AgentRunnerStatusService(root).status({
      repo_id: "fixture",
      heartbeat_stale_seconds: 60,
      stale_lock_seconds: 900,
      detail: "full"
    });

    expect(status.completed_count).toBe(1);
    expect(status.active_count).toBe(0);
    expect(status.last_run_status).toBe("completed_with_lock_warning");
    expect(status.completed_with_lock_warnings).toEqual([
      expect.objectContaining({
        run_id: runId,
        lock_path: `.chatgpt/codex-runs/${runId}/RESULT.md.lock`,
        runner_pid: process.pid,
        result_md_exists: true
      })
    ]);
    expect(status.warnings).toContain("COMPLETED_RESULT_HAS_LOCK");
    expect(status.queue_entries).toEqual([
      expect.objectContaining({
        run_id: runId,
        state: "completed_with_lock_warning",
        lock_path: `.chatgpt/codex-runs/${runId}/RESULT.md.lock`,
        result_md_exists: true,
        terminal: true
      })
    ]);
  });
});

async function writeRun(root: string, runId: string, completed: boolean, resultText = "# Result\nstatus: completed\n"): Promise<void> {
  const runDir = join(root, ".chatgpt/codex-runs", runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "PROMPT.md"), "# Prompt\n");
  await writeFile(join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    repo_id: "fixture",
    run_id: runId,
    prompt_path: `.chatgpt/codex-runs/${runId}/PROMPT.md`,
    result_path: `.chatgpt/codex-runs/${runId}/RESULT.md`
  }));
  if (completed) {
    await writeFile(join(runDir, "RESULT.md"), resultText);
  }
}
