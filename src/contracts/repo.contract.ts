import { z } from "zod";

export const RepoInputSchema = z.object({
  repo_id: z.string().min(1).describe("Stable approved repository id from repo_list_roots.")
});

export const RepoTreeInputSchema = RepoInputSchema.extend({
  path: z.string().optional(),
  max_depth: z.number().int().positive().optional(),
  page_size: z.number().int().positive().optional(),
  include_files: z.boolean().optional(),
  respect_default_excludes: z.boolean().optional(),
  include_generated: z.boolean().optional(),
  include_dependencies: z.boolean().optional(),
  cursor: z.string().optional()
});

const VisionCapabilitySummarySchema = z.object({
  has_configured_vision_route: z.boolean(),
  available_routes: z.array(z.object({
    route: z.enum(["gemini_api", "vertex_gemini", "ollama_local"]),
    available: z.boolean(),
    auth: z.enum(["api_key", "adc", "service_account", "none"]).optional(),
    model: z.string().optional(),
    supports_image_input: z.boolean().optional(),
    evidence: z.array(z.string())
  })),
  missing_capabilities: z.array(z.string()),
  warnings: z.array(z.string()),
  helper: z.object({
    tool: z.literal("repo_write_codex_task"),
    route_status: z.enum(["ready", "blocked"]),
    input_assets_required: z.literal(true),
    result_visibility: z.literal("repo_list_roots.ready_results"),
    preferred_route: z.object({
      route: z.enum(["gemini_api", "vertex_gemini", "ollama_local"]),
      model: z.string().optional(),
      evidence: z.array(z.string())
    }).optional(),
    payload_notes: z.array(z.string()),
    completed_result_template: z.string(),
    blocked_result_template: z.string()
  })
});

const CapabilityStateSchema = z.enum(["available", "unavailable", "unknown", "blocked"]);

const CapabilityMetadataSchema = z.object({
  state: CapabilityStateSchema,
  last_validated_at: z.string(),
  ttl_seconds: z.number(),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.array(z.string()),
  validation_source: z.string(),
  safe_operations: z.array(z.string()),
  blocked_operations: z.array(z.string()),
  suggested_validation_command: z.string()
});

const CapabilitySummarySchema = z.object({
  state_values: z.array(CapabilityStateSchema),
  codex_handoff: z.object({
    state: CapabilityStateSchema,
    tools: z.array(z.string()),
    evidence: z.array(z.string())
  }),
  runner: z.object({
    state: CapabilityStateSchema,
    runner: z.enum(["alive", "dead", "stale", "unknown"]),
    worker: z.enum(["running", "not_running", "unknown"]),
    runtime_assessment: z.enum(["offline", "idle", "running_active_run", "attention_needed"]),
    evidence: z.array(z.string())
  }),
  durable_queue: CapabilityMetadataSchema,
  event_inbox: CapabilityMetadataSchema,
  image_assets: z.object({
    state: CapabilityStateSchema,
    tool: z.literal("repo_write_codex_task"),
    input_assets: z.literal(true),
    evidence: z.array(z.string())
  }),
  vision_route_detection: z.object({
    state: CapabilityStateSchema,
    tool: z.literal("repo_vision_routes"),
    configured_route: z.boolean(),
    evidence: z.array(z.string())
  }),
  ollama: z.object({
    state: CapabilityStateSchema,
    model: z.string(),
    evidence: z.array(z.string())
  }),
  gemma_image_route: z.object({
    state: CapabilityStateSchema,
    model: z.string(),
    evidence: z.array(z.string())
  }),
  latest_validation: z.object({
    state: CapabilityStateSchema,
    run_id: z.string(),
    result_status: z.string(),
    result_path: z.string(),
    source: z.string(),
    evidence: z.array(z.string())
  }),
  opencv: CapabilityMetadataSchema,
  qwen_or_qencoder: CapabilityMetadataSchema,
  git_review: CapabilityMetadataSchema,
  git_stage_commit: CapabilityMetadataSchema,
  repo_ownership_registry: CapabilityMetadataSchema,
  preview_server: CapabilityMetadataSchema,
  tailscale: CapabilityMetadataSchema,
  full_vision_helper: z.object({
    state: z.literal("blocked"),
    note: z.string()
  })
});

const BridgeObservabilitySchema = z.object({
  bridge_process_id: z.number(),
  bridge_started_at: z.string(),
  bridge_uptime_seconds: z.number(),
  tool_catalog_generation: z.string(),
  tool_catalog_loaded_at: z.string(),
  request_observed_at: z.string(),
  request_id: z.string(),
  session_fingerprint: z.string(),
  transport_type: z.string(),
  last_successful_tool_call_at: z.string(),
  last_tool_error: z.string(),
  last_tool_error_code: z.number().nullable(),
  last_tool_error_message: z.string(),
  last_tool_error_observed_at: z.string(),
  suspected_failure_layer: z.string(),
  suggested_next_action: z.string()
});

export const RepoSummarySchema = z.object({
  repo_id: z.string(),
  display_name: z.string(),
  root: z.string(),
  bridge_observability: BridgeObservabilitySchema.optional(),
  runner_status: z.object({}).passthrough().optional(),
  capability_summary: CapabilitySummarySchema.optional(),
  vision_capabilities: VisionCapabilitySummarySchema.optional()
});

export const RepoListResultSchema = z.object({
  repos: z.array(RepoSummarySchema),
  bridge_observability: BridgeObservabilitySchema.optional()
});
