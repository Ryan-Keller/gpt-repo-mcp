import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRunnerStatusResult } from "../contracts/agent-runner.contract.js";
import type { VisionRouteResult } from "./vision-route-service.js";

export type CapabilityState = "available" | "unavailable" | "unknown" | "blocked";

export type CapabilitySummary = {
  state_values: CapabilityState[];
  codex_handoff: {
    state: CapabilityState;
    tools: string[];
    evidence: string[];
    last_validated_at: string;
    ttl_seconds: number;
    confidence: "high" | "medium" | "low";
    validation_source: string;
    safe_operations: string[];
    blocked_operations: string[];
    suggested_validation_command: string;
  };
  runner: {
    state: CapabilityState;
    runner: AgentRunnerStatusResult["runner"];
    worker: AgentRunnerStatusResult["worker"];
    runtime_assessment: AgentRunnerStatusResult["runtime_assessment"];
    evidence: string[];
    last_validated_at: string;
    ttl_seconds: number;
    confidence: "high" | "medium" | "low";
    validation_source: string;
    safe_operations: string[];
    blocked_operations: string[];
    suggested_validation_command: string;
  };
  durable_queue: CapabilityMetadata;
  event_inbox: CapabilityMetadata;
  image_assets: {
    state: CapabilityState;
    tool: "repo_write_codex_task";
    input_assets: true;
    evidence: string[];
    last_validated_at: string;
    ttl_seconds: number;
    confidence: "high" | "medium" | "low";
    validation_source: string;
    safe_operations: string[];
    blocked_operations: string[];
    suggested_validation_command: string;
  };
  vision_route_detection: {
    state: CapabilityState;
    tool: "repo_vision_routes";
    configured_route: boolean;
    evidence: string[];
    last_validated_at: string;
    ttl_seconds: number;
    confidence: "high" | "medium" | "low";
    validation_source: string;
    safe_operations: string[];
    blocked_operations: string[];
    suggested_validation_command: string;
  };
  ollama: {
    state: CapabilityState;
    model: string;
    evidence: string[];
    last_validated_at: string;
    ttl_seconds: number;
    confidence: "high" | "medium" | "low";
    validation_source: string;
    safe_operations: string[];
    blocked_operations: string[];
    suggested_validation_command: string;
  };
  gemma_image_route: {
    state: CapabilityState;
    model: string;
    evidence: string[];
    last_validated_at: string;
    ttl_seconds: number;
    confidence: "high" | "medium" | "low";
    validation_source: string;
    safe_operations: string[];
    blocked_operations: string[];
    suggested_validation_command: string;
  };
  latest_validation: {
    state: CapabilityState;
    run_id: string;
    result_status: string;
    result_path: string;
    source: string;
    evidence: string[];
    last_validated_at: string;
    ttl_seconds: number;
    confidence: "high" | "medium" | "low";
    validation_source: string;
    safe_operations: string[];
    blocked_operations: string[];
    suggested_validation_command: string;
  };
  opencv: CapabilityMetadata;
  qwen_or_qencoder: CapabilityMetadata;
  git_review: CapabilityMetadata;
  git_stage_commit: CapabilityMetadata;
  repo_ownership_registry: CapabilityMetadata;
  preview_server: CapabilityMetadata;
  tailscale: CapabilityMetadata;
  full_vision_helper: {
    state: "blocked";
    note: string;
    last_validated_at: string;
    ttl_seconds: number;
    confidence: "high" | "medium" | "low";
    validation_source: string;
    safe_operations: string[];
    blocked_operations: string[];
    suggested_validation_command: string;
  };
};

export type CapabilityMetadata = {
  state: CapabilityState;
  last_validated_at: string;
  ttl_seconds: number;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  validation_source: string;
  safe_operations: string[];
  blocked_operations: string[];
  suggested_validation_command: string;
};

const IMAGE_VALIDATION_RUN_ID = "2026-06-07T181500Z-image-input-asset-validation";
const IMAGE_VALIDATION_STATUS = "shared/status/2026-06-07-image-input-assets-and-vision-routing.md";

export async function buildCapabilitySummary(input: {
  repo_id: string;
  repo_root: string;
  runner_status: AgentRunnerStatusResult;
  vision_routes: VisionRouteResult;
}): Promise<CapabilitySummary> {
  const runnerStatus = input.runner_status;
  const visionRoutes = input.vision_routes;
  const ollamaRoute = visionRoutes.available_routes.find((route) => route.route === "ollama_local");
  const gemmaRoute = visionRoutes.available_routes.find((route) => (
    route.route === "ollama_local" && /\bgemma/i.test(route.model ?? "")
  ));
  const latestValidation = await latestValidationStatus(input.repo_root, runnerStatus);
  const now = new Date().toISOString();

  return {
    state_values: ["available", "unavailable", "unknown", "blocked"],
    codex_handoff: {
      state: "available",
      tools: ["repo_write_codex_task", "codex_run_and_wait", "repo_codex_review"],
      evidence: ["Tool catalog includes Codex task handoff and run/review tools."],
      ...freshness(now, 300, "high", "tool_catalog", ["write_codex_task", "review_result"], ["stage", "commit", "push"], "live MCP tool-list guard")
    },
    runner: {
      state: runnerCapabilityState(runnerStatus),
      runner: runnerStatus.runner,
      worker: runnerStatus.worker,
      runtime_assessment: runnerStatus.runtime_assessment,
      evidence: [
        `runner=${runnerStatus.runner}`,
        `worker=${runnerStatus.worker}`,
        `runtime_assessment=${runnerStatus.runtime_assessment}`
      ],
      ...freshness(now, 60, runnerStatus.runner === "alive" ? "high" : "medium", "repo_runner_status", ["observe_status", "drain_queue"], ["delete_lock_without_abandonment_proof"], "python projects/agent-runner/agent_runner.py --status-plain")
    },
    durable_queue: capability(
      "available",
      now,
      120,
      "high",
      ["queue_entries exposed through runner_status"],
      "repo_list_roots.runner_status.queue_entries",
      ["observe_queue", "queue_safe_task"],
      ["overwrite_existing_run_id"],
      "python projects/agent-runner/agent_runner.py --status"
    ),
    event_inbox: capability(
      "available",
      now,
      120,
      "high",
      ["recent_events and unresolved_events exposed through runner_status"],
      "repo_list_roots.runner_status",
      ["observe_events", "recommend_next_action", "auto_queue_safe_diagnostic"],
      ["auto_stage", "auto_commit", "auto_push", "auto_delete"],
      "python projects/agent-runner/agent_runner.py --status"
    ),
    image_assets: {
      state: "available",
      tool: "repo_write_codex_task",
      input_assets: true,
      evidence: [
        "repo_write_codex_task.input_assets stores images under .chatgpt/codex-runs/<run_id>/inputs/.",
        "Supported image MIME types are png, jpeg, and webp."
      ],
      ...freshness(now, 3600, "high", "codex_task_service", ["store_input_assets"], ["execute_unvalidated_binary_asset"], "focused input-asset test")
    },
    vision_route_detection: {
      state: visionRoutes.ok ? "available" : "unknown",
      tool: "repo_vision_routes",
      configured_route: visionRoutes.has_configured_vision_route,
      evidence: visionRoutes.has_configured_vision_route
        ? ["At least one configured route advertises image input."]
        : [`Missing: ${visionRoutes.missing_capabilities.join(", ") || "unknown"}`],
      ...freshness(now, 300, visionRoutes.has_configured_vision_route ? "high" : "medium", "repo_vision_routes", ["detect_routes"], ["print_secrets"], "ollama list")
    },
    ollama: {
      state: ollamaCapabilityState(ollamaRoute, visionRoutes.warnings),
      model: ollamaRoute?.model ?? "",
      evidence: ollamaRoute?.evidence ?? visionRoutes.warnings.filter((warning) => /ollama/i.test(warning)),
      ...freshness(now, 300, ollamaRoute?.available ? "high" : "medium", "repo_vision_routes", ["local_model_inference_if_task_scoped"], ["assume_unlisted_model"], "ollama list")
    },
    gemma_image_route: {
      state: gemmaRoute?.supports_image_input ? "available" : visionRoutes.missing_capabilities.includes("MISSING_LOCAL_GEMMA_VISION_MODEL") ? "blocked" : "unknown",
      model: gemmaRoute?.model ?? "",
      evidence: gemmaRoute?.evidence ?? ["MISSING_LOCAL_GEMMA_VISION_MODEL"],
      ...freshness(now, 300, gemmaRoute?.supports_image_input ? "high" : "medium", "repo_vision_routes", ["image_reasoning"], ["deterministic_measurement_without_opencv"], "ollama show <model>")
    },
    latest_validation: latestValidation,
    opencv: capability(
      "unknown",
      now,
      3600,
      "low",
      ["OpenCV route has not been validated by this service yet."],
      "not_validated",
      ["deterministic_image_measurement_when_available"],
      ["claim_visual_reasoning"],
      "python -c \"import cv2; print(cv2.__version__)\""
    ),
    qwen_or_qencoder: capability(
      "unknown",
      now,
      3600,
      "low",
      ["Qwen/Qencoder second-opinion route has not been validated by this service yet."],
      "not_validated",
      ["second_opinion_reasoning_when_available"],
      ["treat_as_authoritative_without_consensus"],
      "ollama list"
    ),
    git_review: capability("available", now, 300, "high", ["repo_git_review is in the tool catalog."], "tool_catalog", ["review_diff", "plan_exact_paths"], ["stage_all"], "repo_git_review"),
    git_stage_commit: capability("blocked", now, 300, "high", ["Git mutation requires human approval and exact path lists."], "agent_contract", ["dry_run_plan"], ["auto_stage", "auto_commit", "auto_push"], "repo_git_review"),
    repo_ownership_registry: capability("available", now, 3600, "medium", ["repo_list_roots enumerates approved repositories."], "repo_list_roots", ["choose_repo_by_owner"], ["assume_monorepo"], "repo_list_roots"),
    preview_server: capability("unknown", now, 3600, "low", ["Preview server availability is per task."], "not_validated", ["serve_local_preview_when_requested"], ["present_host_loopback_as_phone_url"], "Get-NetTCPConnection -LocalPort 8080"),
    tailscale: capability("unknown", now, 3600, "low", ["Tailscale proof is recorded in CURRENT_STATE but should be revalidated for new previews."], "shared/state/CURRENT_STATE.md", ["phone_preview_after_validation"], ["assume_phone_reachability"], "tailscale status"),
    full_vision_helper: {
      state: "blocked",
      note: "Full repo_run_vision_analysis style helpers remain intentionally out of scope for this minimal discovery slice.",
      ...freshness(now, 3600, "high", "explicit_scope_boundary", ["prepare_followup_task"], ["pretend_full_helper_exists"], "repo_write_codex_task with input_assets")
    }
  };
}

function freshness(
  lastValidatedAt: string,
  ttlSeconds: number,
  confidence: "high" | "medium" | "low",
  validationSource: string,
  safeOperations: string[],
  blockedOperations: string[],
  suggestedValidationCommand: string
) {
  return {
    last_validated_at: lastValidatedAt,
    ttl_seconds: ttlSeconds,
    confidence,
    validation_source: validationSource,
    safe_operations: safeOperations,
    blocked_operations: blockedOperations,
    suggested_validation_command: suggestedValidationCommand
  };
}

function capability(
  state: CapabilityState,
  lastValidatedAt: string,
  ttlSeconds: number,
  confidence: "high" | "medium" | "low",
  evidence: string[],
  validationSource: string,
  safeOperations: string[],
  blockedOperations: string[],
  suggestedValidationCommand: string
): CapabilityMetadata {
  return {
    state,
    evidence,
    ...freshness(lastValidatedAt, ttlSeconds, confidence, validationSource, safeOperations, blockedOperations, suggestedValidationCommand)
  };
}

function runnerCapabilityState(status: AgentRunnerStatusResult): CapabilityState {
  if (status.runner === "alive" && status.worker === "running") {
    return "available";
  }
  if (status.runner === "dead" || status.worker === "not_running") {
    return "unavailable";
  }
  if (status.runtime_assessment === "attention_needed") {
    return "blocked";
  }
  return "unknown";
}

function ollamaCapabilityState(
  route: VisionRouteResult["available_routes"][number] | undefined,
  warnings: string[]
): CapabilityState {
  if (route?.available) {
    return "available";
  }
  if (warnings.some((warning) => /ollama/i.test(warning))) {
    return "unavailable";
  }
  return "unknown";
}

async function latestValidationStatus(
  repoRoot: string,
  runnerStatus: AgentRunnerStatusResult
): Promise<CapabilitySummary["latest_validation"]> {
  const readyValidation = runnerStatus.ready_results.find((result) => result.run_id === IMAGE_VALIDATION_RUN_ID);
  if (readyValidation) {
    return {
      state: readyValidation.result_status === "completed" ? "available" : "blocked",
      run_id: readyValidation.run_id,
      result_status: readyValidation.result_status,
      result_path: readyValidation.result_path,
      source: "repo_list_roots.ready_results",
      evidence: ["Validation RESULT.md is available through ready_results."],
      ...freshness(new Date().toISOString(), 3600, "high", "repo_list_roots.ready_results", ["review_validation_result"], ["assume_future_route_without_refresh"], "repo_list_roots")
    };
  }

  const sourcePath = join(repoRoot, IMAGE_VALIDATION_STATUS);
  try {
    await access(sourcePath);
    const text = await readFile(sourcePath, "utf8");
    const hasCompleted = /status:\s*completed/i.test(text) || /Result:\s*[\s\S]*status:\s*completed/i.test(text);
    return {
      state: hasCompleted ? "available" : "unknown",
      run_id: IMAGE_VALIDATION_RUN_ID,
      result_status: hasCompleted ? "completed" : "unknown",
      result_path: `.chatgpt/codex-runs/${IMAGE_VALIDATION_RUN_ID}/RESULT.md`,
      source: IMAGE_VALIDATION_STATUS,
      evidence: ["Shared status note records the image input asset validation run."],
      ...freshness(new Date().toISOString(), 3600, "medium", IMAGE_VALIDATION_STATUS, ["review_status_note"], ["treat_old_note_as_live_route"], "repo_vision_routes")
    };
  } catch {
    return {
      state: "unknown",
      run_id: "",
      result_status: "",
      result_path: "",
      source: "",
      evidence: ["No recent validation evidence found in ready_results or shared status notes."],
      ...freshness(new Date().toISOString(), 300, "low", "not_validated", ["request_validation"], ["assume_available"], "repo_vision_routes")
    };
  }
}
