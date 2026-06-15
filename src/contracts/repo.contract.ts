import { z } from "zod";
import { ConnectorIdentitySnapshotSchema } from "./connector-identity.contract.js";

export const RepoListInputSchema = z.object({
  capability_id: z.string().min(1).optional()
    .describe("Optional exact capability id to expand inside capability_summary without returning the full capability catalog."),
  portal_id: z.string().min(1).optional()
    .describe("Optional portal id to hydrate inside the focused town_portal read-only capability surface. Ignored unless capability_id is town_portal."),
  detail: z.enum(["summary", "full"]).optional()
    .describe("Payload detail level. Defaults to summary, which keeps repo roots compact. Use full only for runner, capability, and vision diagnostics.")
});

export const RepoInputSchema = z.object({
  repo_id: z.string().min(1).describe("Stable approved repository id from repo_list_roots.")
});

export const DefaultReadOnlyRepoInputSchema = z.object({
  repo_id: z.string().min(1).optional()
    .describe("Approved repository id. For this Shared Agent Bridge app, omit this or use shared-agent-bridge unless repo_list_roots reports a different id.")
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

export const VisionCapabilitySummarySchema = z.object({
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

const CapabilityTocSchema = z.object({
  state: CapabilityStateSchema,
  source_path: z.literal("shared/capabilities/BRIDGE_CAPABILITY_TOC_V0.json"),
  generated_at: z.string(),
  capability_count: z.number().int().nonnegative(),
  capabilities: z.array(z.object({
    capability_id: z.string(),
    status: z.string(),
    summary: z.string(),
    existing_tool_or_hub_route: z.string(),
    safe_operations: z.array(z.string()),
    blocked_operations: z.array(z.string()),
    suggested_next_action: z.string(),
    docs_protocol_refs: z.array(z.string()).optional()
  })),
  blocker: z.string().optional()
});

const ModuleRegistrySchema = z.object({
  state: CapabilityStateSchema,
  source_path: z.literal("shared/capabilities/BRIDGE_MODULE_REGISTRY_V0.json"),
  generated_at: z.string(),
  module_count: z.number().int().nonnegative(),
  modules: z.array(z.object({
    module_id: z.string(),
    status: z.string(),
    class: z.string(),
    summary: z.string(),
    source_refs: z.array(z.string()),
    groups_capabilities: z.array(z.string()),
    public_surface: z.string(),
    safe_actions: z.array(z.string()),
    blocked_actions: z.array(z.string())
  })),
  blocker: z.string().optional()
});

const BridgeCompassSchema = z.object({
  current_route: z.string(),
  runner_state: z.object({
    runner: z.enum(["alive", "dead", "stale", "unknown"]),
    worker: z.enum(["running", "not_running", "unknown"]),
    runtime_assessment: z.enum(["offline", "idle", "running_active_run", "attention_needed"]),
    pending_count: z.number().int(),
    active_count: z.number().int(),
    stale_lock_count: z.number().int()
  }).passthrough(),
  active_lane: z.object({
    state: z.enum(["active", "queued", "ready_result_review", "idle", "blocked"]),
    run_id: z.string(),
    lane: z.string()
  }).passthrough(),
  latest_ready_result: z.object({
    run_id: z.string(),
    result_status: z.string(),
    result_path: z.string()
  }).passthrough(),
  top_blocker: z.object({
    status: z.enum(["none", "blocked"]),
    source: z.string(),
    summary: z.string()
  }).passthrough(),
  module_handles: z.array(z.object({
    module_id: z.string(),
    status: z.string(),
    class: z.string()
  }).passthrough()),
  proof_layer: z.enum(["source-tested", "local-live", "blocked", "unknown"]),
  next_safe_action: z.string(),
  context_budget_hint: z.string()
}).passthrough();

export const CapabilitySummarySchema = z.object({
  state_values: z.array(CapabilityStateSchema),
  bridge_compass: BridgeCompassSchema,
  capability_toc: CapabilityTocSchema,
  module_registry: ModuleRegistrySchema,
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
  suggested_next_action: z.string(),
  connector_identity: ConnectorIdentitySnapshotSchema
});

export const RepoSummarySchema = z.object({
  repo_id: z.string(),
  display_name: z.string(),
  root: z.string(),
  bridge_observability: BridgeObservabilitySchema.optional(),
  runner_status: z.object({}).passthrough().optional(),
  capability_summary: z.object({}).passthrough().optional(),
  vision_capabilities: z.object({}).passthrough().optional()
});

export const RepoListResultSchema = z.object({
  repos: z.array(RepoSummarySchema),
  bridge_observability: BridgeObservabilitySchema.optional()
});

const CapabilityHandleSchema = z.object({
  capability_id: z.string(),
  status: z.string()
}).passthrough();

const ModuleHandleSchema = z.object({
  module_id: z.string(),
  status: z.string(),
  class: z.string()
}).passthrough();

const CapabilityReferenceSummarySchema = z.object({
  expansion: z.object({
    mode: z.enum(["skeletal", "focused", "full"]).optional(),
    detail: z.string().optional(),
    focused: z.boolean().optional(),
    capability_id: z.string().optional(),
    found: z.boolean().optional(),
    full_detail_hint: z.string().optional()
  }).passthrough().optional(),
  bridge_compass: BridgeCompassSchema.optional(),
  capability_toc: z.object({
    state: z.string().optional(),
    capability_count: z.number().int().nonnegative().optional(),
    returned_count: z.number().int().nonnegative().optional(),
    capabilities: z.array(CapabilityHandleSchema).optional()
  }).passthrough().optional(),
  module_registry: z.object({
    state: z.string().optional(),
    module_count: z.number().int().nonnegative().optional(),
    returned_count: z.number().int().nonnegative().optional(),
    modules: z.array(ModuleHandleSchema).optional()
  }).passthrough().optional()
}).passthrough();

const RunnerStatusReferenceSchema = z.object({
  ok: z.boolean().optional(),
  repo_id: z.string().optional(),
  detail_level: z.enum(["summary", "full"]).optional(),
  details_truncated: z.boolean().optional(),
  runner: z.enum(["alive", "dead", "stale", "unknown"]).optional(),
  worker: z.enum(["running", "not_running", "unknown"]).optional(),
  runtime_assessment: z.enum(["offline", "idle", "running_active_run", "attention_needed"]).optional(),
  active_run_ids: z.array(z.string()).optional(),
  pending_count: z.number().int().optional(),
  active_count: z.number().int().optional(),
  stale_lock_count: z.number().int().optional(),
  completed_count: z.number().int().optional(),
  blocked_count: z.number().int().optional(),
  plain_text: z.string().optional(),
  warnings: z.array(z.string()).optional()
}).passthrough();

export const RepoListReferenceResultSchema = z.object({
  repos: z.array(z.object({
    repo_id: z.string(),
    display_name: z.string(),
    root: z.string(),
    runner_status: RunnerStatusReferenceSchema.optional(),
    capability_summary: CapabilityReferenceSummarySchema.optional(),
    vision_capabilities: z.object({
      has_configured_vision_route: z.boolean().optional(),
      route_status: z.string().optional(),
      missing_capabilities: z.array(z.string()).optional(),
      warnings: z.array(z.string()).optional(),
      helper: z.object({
        tool: z.string().optional(),
        input_assets_required: z.boolean().optional(),
        result_visibility: z.string().optional(),
        route_status: z.string().optional()
      }).passthrough().optional()
    }).passthrough().optional()
  }).passthrough()),
  bridge_observability: z.object({
    transport_type: z.string().optional(),
    suggested_next_action: z.string().optional()
  }).passthrough().optional()
}).passthrough();
