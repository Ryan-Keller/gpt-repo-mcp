import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { AgentRunnerStatusResult } from "../src/contracts/agent-runner.contract.js";
import { buildCapabilitySummary } from "../src/services/capability-summary-service.js";
import type { VisionRouteResult } from "../src/services/vision-route-service.js";

describe("capability summary service", () => {
  test("summarizes available handoff, runner, image assets, Ollama Gemma vision, and validation evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "capability-summary-"));
    await mkdir(join(root, "shared", "status"), { recursive: true });
    await writeFile(
      join(root, "shared", "status", "2026-06-07-image-input-assets-and-vision-routing.md"),
      "# Image Input Assets And Vision Routing\n\nResult:\n- status: completed\n"
    );

    const summary = await buildCapabilitySummary({
      repo_id: "shared-agent-bridge",
      repo_root: root,
      runner_status: runnerStatus({ runner: "alive", worker: "running", runtime_assessment: "idle" }),
      vision_routes: {
        ok: true,
        has_configured_vision_route: true,
        available_routes: [{
          route: "ollama_local",
          available: true,
          auth: "none",
          model: "hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_M",
          supports_image_input: true,
          evidence: ["OLLAMA_SHOW_CAPABILITIES_VISION"]
        }],
        missing_capabilities: [],
        warnings: []
      }
    });

    expect(summary.codex_handoff.state).toBe("available");
    expect(summary.runner.state).toBe("available");
    expect(summary.image_assets.state).toBe("available");
    expect(summary.vision_route_detection.state).toBe("available");
    expect(summary.ollama.state).toBe("available");
    expect(summary.gemma_image_route.state).toBe("available");
    expect(summary.latest_validation).toMatchObject({
      state: "available",
      run_id: "2026-06-07T181500Z-image-input-asset-validation",
      result_status: "completed"
    });
    expect(summary.full_vision_helper.state).toBe("blocked");
    expect(summary.event_inbox).toMatchObject({
      state: "available",
      validation_source: "repo_list_roots.runner_status",
      safe_operations: expect.arrayContaining(["observe_events", "recommend_next_action"])
    });
    expect(summary.gemma_image_route).toMatchObject({
      last_validated_at: expect.any(String),
      ttl_seconds: expect.any(Number),
      confidence: "high",
      validation_source: "repo_vision_routes"
    });
  });

  test("distinguishes unavailable runner, unavailable Ollama, blocked Gemma image route, and unknown validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "capability-summary-"));
    const summary = await buildCapabilitySummary({
      repo_id: "shared-agent-bridge",
      repo_root: root,
      runner_status: runnerStatus({ runner: "dead", worker: "not_running", runtime_assessment: "offline" }),
      vision_routes: {
        ok: true,
        has_configured_vision_route: false,
        available_routes: [],
        missing_capabilities: [
          "MISSING_GEMINI_API_KEY",
          "MISSING_VERTEX_AUTH",
          "MISSING_LOCAL_GEMMA_VISION_MODEL",
          "NO_CONFIGURED_VISION_ROUTE"
        ],
        warnings: ["ollama list failed"]
      }
    });

    expect(summary.runner.state).toBe("unavailable");
    expect(summary.ollama.state).toBe("unavailable");
    expect(summary.gemma_image_route.state).toBe("blocked");
    expect(summary.latest_validation.state).toBe("unknown");
    expect(summary.state_values).toEqual(["available", "unavailable", "unknown", "blocked"]);
    expect(summary.opencv).toMatchObject({
      state: "unknown",
      suggested_validation_command: "python -c \"import cv2; print(cv2.__version__)\""
    });
    expect(summary.qwen_or_qencoder).toMatchObject({
      state: "unknown",
      suggested_validation_command: "ollama list"
    });
  });
});

function runnerStatus(overrides: Partial<AgentRunnerStatusResult>): AgentRunnerStatusResult {
  return {
    ok: true,
    repo_id: "shared-agent-bridge",
    runner_state: "alive",
    runner: "alive",
    worker: "running",
    runtime_assessment: "idle",
    heartbeat_path: "projects/agent-runner/reports/runner-heartbeat.json",
    heartbeat_updated_at: "",
    heartbeat_age_seconds: null,
    heartbeat_status: "missing",
    runner_pid: null,
    active_run_id: "",
    active_locks: [],
    stale_locks: [],
    completed_with_lock_warnings: [],
    active_run_ids: [],
    active_runs: [],
    pending_count: 0,
    active_count: 0,
    stale_lock_count: 0,
    completed_count: 0,
    blocked_count: 0,
    last_run_id: "",
    last_run_status: "",
    ready_results: [],
    queue_entries: [],
    recent_events: [],
    unresolved_events: [],
    event_log_path: ".chatgpt/events/bridge-events.jsonl",
    event_cursor: "",
    event_count: 0,
    unresolved_event_count: 0,
    acknowledgement_policy: "Events are unresolved while acknowledged=false and unread=true; status reads do not acknowledge events.",
    plain_text: "Runner: alive",
    warnings: [],
    ...overrides
  };
}
