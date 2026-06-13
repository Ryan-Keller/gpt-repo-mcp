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
    await writeCapabilityToc(root);
    await writeModuleRegistry(root);
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
    expect(summary.capability_toc).toMatchObject({
      state: "available",
      source_path: "shared/capabilities/BRIDGE_CAPABILITY_TOC_V0.json",
      generated_at: "2026-06-12T08:46:28Z",
      capability_count: 1,
      capabilities: [
        expect.objectContaining({
          capability_id: "town_portal",
          status: "documented_experimental",
          existing_tool_or_hub_route: "repo_runner_status.capability_summary.capability_toc",
          docs_protocol_refs: ["shared/protocols/TOWN_PORTAL_PRIMITIVE_V0.md"]
        })
      ]
    });
    expect(summary.module_registry).toMatchObject({
      state: "available",
      source_path: "shared/capabilities/BRIDGE_MODULE_REGISTRY_V0.json",
      generated_at: "2026-06-13T00:48:49Z",
      module_count: 2,
      modules: [
        expect.objectContaining({
          module_id: "save_crystal",
          status: "documented_draft",
          class: "protocol_backed",
          source_refs: ["shared/protocols/AUTONOMOUS_SAVE_CRYSTAL_LANE_V0.md"],
          safe_actions: ["inspect_status"]
        }),
        expect.objectContaining({
          module_id: "town_portal",
          status: "documented_experimental",
          class: "validator_needed"
        })
      ]
    });
    expect(summary.bridge_compass).toMatchObject({
      current_route: "repo_runner_status.capability_summary.bridge_compass",
      runner_state: {
        runner: "alive",
        worker: "running",
        runtime_assessment: "idle",
        pending_count: 0,
        active_count: 0,
        stale_lock_count: 0
      },
      active_lane: {
        state: "idle",
        run_id: "",
        lane: "observe_only"
      },
      latest_ready_result: {
        run_id: "",
        result_status: "",
        result_path: ""
      },
      top_blocker: {
        status: "none",
        source: "",
        summary: ""
      },
      module_handles: [
        {
          module_id: "save_crystal",
          status: "documented_draft",
          class: "protocol_backed"
        },
        {
          module_id: "town_portal",
          status: "documented_experimental",
          class: "validator_needed"
        }
      ],
      proof_layer: "local-live",
      next_safe_action: "observe_only"
    });
    expect(summary.bridge_compass.context_budget_hint).toContain("Use bridge_compass first");
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
    expect(summary.capability_toc).toMatchObject({
      state: "unavailable",
      source_path: "shared/capabilities/BRIDGE_CAPABILITY_TOC_V0.json",
      capability_count: 0,
      capabilities: [],
      blocker: "Capability TOC file is missing."
    });
    expect(summary.module_registry).toMatchObject({
      state: "unavailable",
      source_path: "shared/capabilities/BRIDGE_MODULE_REGISTRY_V0.json",
      module_count: 0,
      modules: [],
      blocker: "Bridge module registry file is missing."
    });
    expect(summary.bridge_compass).toMatchObject({
      runner_state: {
        runner: "dead",
        worker: "not_running",
        runtime_assessment: "offline"
      },
      active_lane: {
        state: "idle",
        lane: "observe_only"
      },
      top_blocker: {
        status: "blocked",
        source: "repo_runner_status.runner",
        summary: "Runner is dead."
      },
      module_handles: [],
      proof_layer: "blocked",
      next_safe_action: "review_blocker_source"
    });
  });

  test("reports invalid capability TOC JSON as blocked without throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "capability-summary-"));
    await mkdir(join(root, "shared", "capabilities"), { recursive: true });
    await writeFile(join(root, "shared", "capabilities", "BRIDGE_CAPABILITY_TOC_V0.json"), "{ invalid json");

    const summary = await buildCapabilitySummary({
      repo_id: "shared-agent-bridge",
      repo_root: root,
      runner_status: runnerStatus({ runner: "alive", worker: "running", runtime_assessment: "idle" }),
      vision_routes: emptyVisionRoutes()
    });

    expect(summary.capability_toc).toMatchObject({
      state: "blocked",
      source_path: "shared/capabilities/BRIDGE_CAPABILITY_TOC_V0.json",
      capability_count: 0,
      capabilities: [],
      blocker: "Capability TOC JSON could not be parsed."
    });
  });

  test("reports invalid bridge module registry JSON as blocked without throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "capability-summary-"));
    await mkdir(join(root, "shared", "capabilities"), { recursive: true });
    await writeFile(join(root, "shared", "capabilities", "BRIDGE_MODULE_REGISTRY_V0.json"), "{ invalid json");

    const summary = await buildCapabilitySummary({
      repo_id: "shared-agent-bridge",
      repo_root: root,
      runner_status: runnerStatus({ runner: "alive", worker: "running", runtime_assessment: "idle" }),
      vision_routes: emptyVisionRoutes()
    });

    expect(summary.module_registry).toMatchObject({
      state: "blocked",
      source_path: "shared/capabilities/BRIDGE_MODULE_REGISTRY_V0.json",
      module_count: 0,
      modules: [],
      blocker: "Bridge module registry JSON could not be parsed."
    });
  });
});

async function writeCapabilityToc(root: string): Promise<void> {
  await mkdir(join(root, "shared", "capabilities"), { recursive: true });
  await writeFile(join(root, "shared", "capabilities", "BRIDGE_CAPABILITY_TOC_V0.json"), JSON.stringify({
    generated_at: "2026-06-12T08:46:28Z",
    hub_integration: { current_state: "manifest_created_docs_linked" },
    capabilities: [{
      capability_id: "town_portal",
      status: "documented_experimental",
      summary: "Single-use continuation handle.",
      existing_tool_or_hub_route: "repo_runner_status.capability_summary.capability_toc",
      docs_protocol_refs: ["shared/protocols/TOWN_PORTAL_PRIMITIVE_V0.md"],
      safe_operations: ["display_only_knowledge_record"],
      blocked_operations: ["queue_codex_runs"],
      suggested_next_action: "Implement read-only hub summary first."
    }]
  }));
}

async function writeModuleRegistry(root: string): Promise<void> {
  await mkdir(join(root, "shared", "capabilities"), { recursive: true });
  await writeFile(join(root, "shared", "capabilities", "BRIDGE_MODULE_REGISTRY_V0.json"), JSON.stringify({
    generated_at: "2026-06-13T00:48:49Z",
    modules: [
      {
        module_id: "save_crystal",
        status: "documented_draft",
        class: "protocol_backed",
        summary: "Checkpoint detection and helper packaging.",
        source_refs: ["shared/protocols/AUTONOMOUS_SAVE_CRYSTAL_LANE_V0.md"],
        groups_capabilities: ["fresh_state_preflight"],
        public_surface: "existing hub/status/repo review routes only; no new tool name",
        safe_actions: ["inspect_status"],
        blocked_actions: ["push"]
      },
      {
        module_id: "town_portal",
        status: "documented_experimental",
        class: "validator_needed",
        summary: "Single-use continuation handle.",
        source_refs: ["shared/protocols/TOWN_PORTAL_PRIMITIVE_V0.md"],
        groups_capabilities: ["town_portal"],
        public_surface: "capability hub summary",
        safe_actions: ["display_only_knowledge_record"],
        blocked_actions: ["queue_codex_runs"]
      }
    ]
  }));
}

function emptyVisionRoutes(): VisionRouteResult {
  return {
    ok: true,
    has_configured_vision_route: false,
    available_routes: [],
    missing_capabilities: ["NO_CONFIGURED_VISION_ROUTE"],
    warnings: []
  };
}

function runnerStatus(overrides: Partial<AgentRunnerStatusResult>): AgentRunnerStatusResult {
  const base = {
    ok: true,
    repo_id: "shared-agent-bridge",
    detail_level: "summary",
    details_truncated: true,
    full_detail_hint: "Call repo_runner_status with detail: \"full\" only when needed.",
    connector_status: "healthy",
    last_connector_success_at: "",
    last_connector_error_at: "",
    last_connector_error_kind: "",
    last_successful_tool_call: "",
    last_failed_tool_call: "",
    suspected_cause: "",
    suggested_next_action: "",
    server_started_at: "",
    current_uptime_seconds: 0,
    tool_catalog_hash: "",
    contract_schema_version: "",
    auth_status: "",
    connector_identity: {
      auth_mode: "none",
      app_auth_header_present: false,
      route_token_present: false,
      route_token_valid: false,
      cloudflare_access_present: false,
      chatgpt_callable_surface_verified: false,
      server_catalog_has_repo_connector_whoami: false,
      callable_surface_warning: ""
    },
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
    max_parallel_runs: 1,
    worker_slot_count: 1,
    active_worker_slots: 0,
    idle_worker_slots: 1,
    queued_because_at_capacity: false,
    worker_slots: [],
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
    poll_count: 1,
    poll_interval_seconds: 0,
    monitoring_stop_reason: "single_shot",
    poll_history: [],
    plain_text: "Runner: alive",
    warnings: [],
  } as unknown as AgentRunnerStatusResult;
  return { ...base, ...overrides } as AgentRunnerStatusResult;
}
