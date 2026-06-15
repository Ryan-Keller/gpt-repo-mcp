import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AgentRunnerStatusService } from "../services/agent-runner-status-service.js";
import { BridgeConciergeService } from "../services/bridge-concierge-service.js";
import { PathSandbox } from "../services/path-sandbox.js";
import { CleanupService } from "../services/cleanup-service.js";
import { RepoTreeService } from "../services/repo-tree-service.js";
import { SearchService } from "../services/search-service.js";
import { FileReader } from "../services/file-reader.js";
import { GitService } from "../services/git-service.js";
import { GitReviewService } from "../services/git-review-service.js";
import { GitOperationsService } from "../services/git-operations-service.js";
import { HandoffService } from "../services/handoff-service.js";
import { LabExecService } from "../services/lab-exec-service.js";
import { TownPortalConsumptionStore } from "../services/town-portal-consumption-store.js";
import { TownPortalReturnService } from "../services/town-portal-return-service.js";
import { OperationsPolicy } from "../services/operations-policy.js";
import { ReviewPlanner } from "../services/review-planner.js";
import { ReadManyService } from "../services/read-many-service.js";
import { ProjectBriefService } from "../services/project-brief-service.js";
import { ProjectMemoryService } from "../services/project-memory-service.js";
import { TaskInventoryService } from "../services/task-inventory-service.js";
import { VisionRouteService, buildVisionAnalysisFallback } from "../services/vision-route-service.js";
import { buildCapabilitySummary } from "../services/capability-summary-service.js";
import { PortalInboxService } from "../services/portal-inbox-service.js";
import { DecisionLogService } from "../services/decision-log-service.js";
import { ChangePlanService } from "../services/change-plan-service.js";
import { CodexResultService } from "../services/codex-result-service.js";
import { CodexRunService } from "../services/codex-run-service.js";
import { CodexTaskService } from "../services/codex-task-service.js";
import { NextActionService } from "../services/next-action-service.js";
import { PolicyExplainService } from "../services/policy-explain-service.js";
import { FileWriter } from "../services/file-writer.js";
import { WriteChangesService } from "../services/write-changes-service.js";
import { WritePolicy } from "../services/write-policy.js";
import { OperationReceiptService } from "../services/operation-receipt-service.js";
import { createErrorEnvelope, createSuccessEnvelope } from "../runtime/result-envelope.js";
import { toRepoReaderError } from "../runtime/errors.js";
import { audit, getRequestTelemetry, type RequestTelemetryContext } from "../runtime/telemetry.js";
import { getConnectorDiagnostics } from "../runtime/connector-session.js";
import { buildConnectorIdentitySnapshot } from "../runtime/connector-identity.js";
import type { RuntimeContext } from "../runtime/context.js";
import type { AgentRunnerStatusInput, RunLiveTailInput } from "../contracts/agent-runner.contract.js";
import type { BridgeConciergeInput } from "../contracts/bridge-concierge.contract.js";
import type { SearchOptions } from "../services/search-service.js";
import type { FetchFileOptions } from "../services/file-reader.js";
import type { TreeOptions } from "../services/repo-tree-service.js";
import type { ProjectBriefInput } from "../contracts/project.contract.js";
import type { ProjectMemoryInput } from "../contracts/project-memory.contract.js";
import type { TaskInventoryInput } from "../contracts/task.contract.js";
import type { DecisionLogInput } from "../contracts/decision.contract.js";
import type { ChangePlanInput } from "../contracts/change-plan.contract.js";
import type { CodexReviewInput, CodexRunAndWaitInput, CodexTaskBatchWriteInput, CodexTaskInput, CodexTaskWriteInput } from "../contracts/codex-task.contract.js";
import type { NextActionInput } from "../contracts/next-action.contract.js";
import type { VisionRouteInput } from "../contracts/vision-route.contract.js";
import type { LastWriteInput } from "../contracts/operation-receipt.contract.js";
import type { PolicyExplainInput } from "../contracts/policy.contract.js";
import type { WriteChangesInput, WriteFileInput } from "../contracts/write.contract.js";
import type { GitCommitInput, GitRecoverInput, GitRestorePathsInput, GitStageCommitInput, GitStageInput, GitUnstageInput } from "../contracts/git-operations.contract.js";
import type { GitReviewInput } from "../contracts/git-review.contract.js";
import type { CleanupPathsInput } from "../contracts/cleanup.contract.js";
import type { HandoffInput } from "../contracts/handoff.contract.js";
import type { LabExecInput } from "../contracts/lab-exec.contract.js";
import { TownPortalReturnInputSchema, type TownPortalReturnInput } from "../contracts/town-portal.contract.js";
import type { ConnectorWhoamiResult } from "../contracts/connector-whoami.contract.js";

type RepoInput = { repo_id: string };
type ReadManyInput = RepoInput & {
  paths?: string[];
  include_globs?: string[];
  exclude_globs?: string[];
  max_files?: number;
  max_bytes_per_file?: number;
  max_total_bytes?: number;
  cursor?: string;
};
type GitDiffInput = RepoInput & {
  base?: string;
  compare?: string;
  staged?: boolean;
  unstaged?: boolean;
  paths?: string[];
  max_bytes?: number;
  context_lines?: number;
};

export type ToolHandler = (input: unknown, context: RuntimeContext) => Promise<CallToolResult>;
const townPortalConsumedIdsByRepoRoot = new Map<string, Set<string>>();

const RepoListRootsInput = z.object({
  capability_id: z.string().min(1).optional(),
  portal_id: z.string().min(1).optional(),
  detail: z.enum(["summary", "full"]).optional()
});

export const listRootsHandler: ToolHandler = async (input, context) => {
  const args = RepoListRootsInput.parse(input ?? {});
  const detail = args.detail ?? "summary";
  const repos = context.registry.list();
  context.diagnostics?.recordSuccess();
  const connectorDiagnostics = getConnectorDiagnostics();
  const fallbackStartedAt = new Date().toISOString();
  const baseBridgeObservability = context.diagnostics?.snapshot() ?? {
    bridge_process_id: process.pid,
    bridge_started_at: fallbackStartedAt,
    bridge_uptime_seconds: 0,
    tool_catalog_generation: "in_memory_context",
    tool_catalog_loaded_at: fallbackStartedAt,
    request_observed_at: fallbackStartedAt,
    request_id: "",
    session_fingerprint: "",
    transport_type: "streamable_http",
    last_successful_tool_call_at: "",
    last_tool_error: "",
    last_tool_error_code: null,
    last_tool_error_message: "",
    last_tool_error_observed_at: "",
    suspected_failure_layer: "none_observed",
    suggested_next_action: "observe_only",
    connector_identity: buildConnectorIdentitySnapshot()
  };
  const bridgeObservability = {
    ...baseBridgeObservability,
    last_successful_tool_call_at: connectorDiagnostics.last_connector_success_at,
    last_tool_error: connectorDiagnostics.last_connector_error_kind,
    last_tool_error_code: baseBridgeObservability.last_tool_error_code,
    last_tool_error_message: connectorDiagnostics.last_connector_error_kind
      ? `Last observed connector error: ${connectorDiagnostics.last_connector_error_kind}`
      : connectorDiagnostics.suspected_cause,
    last_tool_error_observed_at: connectorDiagnostics.last_connector_error_at,
    suspected_failure_layer: connectorDiagnostics.connector_status === "healthy" ? "none_observed" : connectorDiagnostics.last_connector_error_kind || "none_observed",
    suggested_next_action: connectorDiagnostics.suggested_next_action
  };
  const reposWithFallbacks = await Promise.all(repos.map(async (repo) => {
    const [runnerStatus, visionRoutes] = await Promise.all([
      new AgentRunnerStatusService(repo.root).status({ repo_id: repo.repo_id, detail }),
      new VisionRouteService().detect()
    ]);
    const capabilitySummary = await buildCapabilitySummary({
      repo_id: repo.repo_id,
      repo_root: repo.root,
      runner_status: runnerStatus,
      vision_routes: visionRoutes
    });
    const hasVisionRoute = visionRoutes.has_configured_vision_route;
    return {
      ...repo,
      bridge_observability: bridgeObservability,
      runner_status: runnerStatus,
      capability_summary: await capabilitySummaryForResponse(capabilitySummary, {
        detail,
        capabilityId: args.capability_id,
        portalId: args.portal_id,
        repoRoot: repo.root
      }),
      vision_capabilities: detail === "full"
        ? {
            has_configured_vision_route: hasVisionRoute,
            available_routes: visionRoutes.available_routes,
            missing_capabilities: visionRoutes.missing_capabilities,
            warnings: visionRoutes.warnings.map(redactSecretLike),
            helper: buildVisionAnalysisFallback(visionRoutes)
          }
        : {
            has_configured_vision_route: hasVisionRoute,
            route_status: hasVisionRoute ? "ready" : "blocked",
            missing_capabilities: visionRoutes.missing_capabilities.slice(0, 4),
            warnings: visionRoutes.warnings.map(redactSecretLike).slice(0, 3),
            helper: {
              tool: "repo_write_codex_task",
              input_assets_required: true,
              result_visibility: "repo_list_roots.ready_results",
              route_status: hasVisionRoute ? "ready" : "blocked"
            }
          }
    };
  }));
  const runnerSummaries = reposWithFallbacks.map((repo) => {
    const visionStatus = repo.vision_capabilities.has_configured_vision_route
      ? "ready"
      : `blocked (${repo.vision_capabilities.missing_capabilities.join(", ")})`;
    return [
      repo.repo_id,
      repo.runner_status.plain_text,
      `Bridge compass: lane=${repo.capability_summary.bridge_compass.active_lane.lane}; blocker=${repo.capability_summary.bridge_compass.top_blocker.status}; next=${repo.capability_summary.bridge_compass.next_safe_action}`,
      `Capabilities: toc=${repo.capability_summary.capability_toc.state}; expansion=${repo.capability_summary.expansion.mode}`,
      `Capability TOC: ${repo.capability_summary.capability_toc.state}; count=${repo.capability_summary.capability_toc.capability_count}; ids=${repo.capability_summary.capability_toc.capabilities.map((entry: { capability_id: string }) => entry.capability_id).join(", ") || "none"}`,
      `Module registry: ${repo.capability_summary.module_registry.state}; count=${repo.capability_summary.module_registry.module_count}; ids=${repo.capability_summary.module_registry.modules.map((entry: { module_id: string }) => entry.module_id).join(", ") || "none"}`,
      `Vision routes: ${visionStatus}`,
      detail === "full"
        ? "Vision helper: repo_write_codex_task with input_assets; results appear in repo_list_roots.ready_results."
        : "Detail: summary; request detail: \"full\" for runner, capability, and vision diagnostics."
    ].join("\n");
  }).join("\n\n");
  return createSuccessEnvelope({ repos: reposWithFallbacks, bridge_observability: bridgeObservability }, `${repos.length} approved repositories available.\n\n${runnerSummaries}`);
};

export const bridgeConciergeHandler: ToolHandler = async (input, context) => safeTool<BridgeConciergeInput>("repo_bridge_concierge", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new BridgeConciergeService(repo).answer({
    request: args.request,
    include_evidence: args.include_evidence
  });
  audit({
    tool: "repo_bridge_concierge",
    repo_id: args.repo_id,
    counts: {
      evidence: result.evidence.length,
      latest_progress: result.latest_progress.length,
      open_issues: result.open_issues.length
    },
    warnings: result.warnings
  });
  return createSuccessEnvelope(result, result.plain_text, { warnings: result.warnings });
});

export const agentRunnerStatusHandler: ToolHandler = async (input, context) => safeTool<AgentRunnerStatusInput>("repo_runner_status", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const [result, visionRoutes] = await Promise.all([
    new AgentRunnerStatusService(repo.root).status(args),
    new VisionRouteService().detect()
  ]);
  const capabilitySummary = await buildCapabilitySummary({
    repo_id: repo.repo_id,
    repo_root: repo.root,
    runner_status: result,
    vision_routes: visionRoutes
  });
  const resultWithCapabilities = {
    ok: result.ok,
    repo_id: result.repo_id,
    detail_level: result.detail_level,
    details_truncated: result.details_truncated,
    full_detail_hint: result.full_detail_hint,
    runner: result.runner,
    worker: result.worker,
    runtime_assessment: result.runtime_assessment,
    active_run_id: result.active_run_id,
    active_run_ids: result.active_run_ids,
    pending_count: result.pending_count,
    active_count: result.active_count,
    stale_lock_count: result.stale_lock_count,
    completed_count: result.completed_count,
    blocked_count: result.blocked_count,
    ready_results: result.ready_results.map((readyResult) => ({
      run_id: readyResult.run_id,
      status: readyResult.status,
      result_status: readyResult.result_status,
      result_path: readyResult.result_path,
      summary: readyResult.summary,
      changed_file_count: readyResult.changed_file_count,
      key_tests: readyResult.key_tests,
      blocker: readyResult.blocker,
      proof_layer: readyResult.proof_layer,
      next_action: readyResult.next_action,
      preview_urls: readyResult.preview_urls
    })),
    plain_text: result.plain_text,
    warnings: result.warnings,
    capability_summary: await capabilitySummaryForResponse(capabilitySummary, {
      detail: result.detail_level,
      capabilityId: args.capability_id,
      portalId: args.portal_id,
      repoRoot: repo.root,
      runnerStatusSurface: true
    })
  };
  audit({
    tool: "repo_runner_status",
    repo_id: args.repo_id,
    counts: {
      pending: result.pending_count,
      active: result.active_count,
      completed: result.completed_count,
      blocked: result.blocked_count
    },
    warnings: result.warnings
  });
  return createSuccessEnvelope(resultWithCapabilities, result.plain_text, { warnings: result.warnings });
});

export const runLiveTailHandler: ToolHandler = async (input, context) => safeTool<RunLiveTailInput>("repo_run_live_tail", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new AgentRunnerStatusService(repo.root).liveTail(args);
  audit({
    tool: "repo_run_live_tail",
    repo_id: args.repo_id,
    counts: { events: result.events.length },
    warnings: result.warnings
  });
  const summary = result.events.length
    ? `Returned ${result.events.length} live-tail events for ${args.run_id}.`
    : `No live-tail events found for ${args.run_id}.`;
  return createSuccessEnvelope(result, summary, { warnings: result.warnings });
});

export const connectorWhoamiHandler: ToolHandler = async (_input, _context) => {
  const telemetry = getRequestTelemetry();
  const observedAt = new Date().toISOString();
  const routeTokenValid = telemetry?.route_token_valid === true;
  const authorizationHeaderPresent = telemetry?.authorization_header_present === true;
  const bridgeAuthHeaderPresent = telemetry?.bridge_auth_header_present === true;
  const cloudflareAccessCandidate = telemetry?.cloudflare_access_email_present === true ||
    telemetry?.cloudflare_access_jwt_present === true;
  const callerHint = routeTokenValid
    ? "tokenized_route"
    : authorizationHeaderPresent || bridgeAuthHeaderPresent
      ? "header_auth_candidate"
      : cloudflareAccessCandidate
        ? "cloudflare_access_candidate"
        : "public_or_unknown";
  const result: ConnectorWhoamiResult = {
    ok: true,
    observed_at: observedAt,
    bridge_process_id: process.pid,
    bridge_started_at: getConnectorDiagnostics().server_started_at,
    route: telemetry?.route ?? "unknown",
    http_method: telemetry?.http_method ?? "unknown",
    mcp_method: telemetry?.mcp_method ?? "unknown",
    mcp_tool: telemetry?.mcp_tool ?? "unknown",
    mcp_session: telemetry?.mcp_session ?? "unknown",
    session_fingerprint: telemetry?.session_fingerprint ?? "",
    authentication_required: true,
    auth_status: getConnectorDiagnostics().auth_status,
    path_token_connector_auth: process.env.BRIDGE_ALLOW_PATH_TOKEN_CONNECTOR_AUTH === "1" ||
      process.env.GPT_REPO_ALLOW_PATH_TOKEN_CONNECTOR_AUTH === "1" ? "enabled" : "disabled",
    public_path_token_configured: Boolean(process.env.GPT_REPO_PUBLIC_PATH_TOKEN || process.env.REPO_READER_PUBLIC_PATH_TOKEN),
    route_token_present: telemetry?.route_token_present === true,
    route_token_valid: routeTokenValid,
    authorization_header_present: authorizationHeaderPresent,
    bridge_auth_header_present: bridgeAuthHeaderPresent,
    cloudflare_access_email_present: telemetry?.cloudflare_access_email_present === true,
    cloudflare_access_jwt_present: telemetry?.cloudflare_access_jwt_present === true,
    cf_ray_present: telemetry?.cf_ray_present === true,
    forwarded_proto: telemetry?.forwarded_proto ?? "",
    caller_classification_hint: callerHint,
    interpretation: connectorWhoamiInterpretation(callerHint, telemetry),
    suggested_next_action: connectorWhoamiNextAction(callerHint, telemetry)
  };
  audit({ tool: "repo_connector_whoami" });
  return createSuccessEnvelope(
    result,
    `Connector route=${result.route}; session=${result.mcp_session}; auth_header=${result.authorization_header_present || result.bridge_auth_header_present ? "present" : "missing"}; route_token_valid=${result.route_token_valid}; cloudflare_access=${result.cloudflare_access_email_present || result.cloudflare_access_jwt_present ? "present" : "missing"}.`
  );
};

function connectorWhoamiInterpretation(
  callerHint: ConnectorWhoamiResult["caller_classification_hint"],
  telemetry: RequestTelemetryContext | undefined
): string {
  if (callerHint === "tokenized_route") {
    return "This tool call arrived through the tokenized MCP route. If tool discovery works but later calls terminate, refresh the connector URL and start a fresh ChatGPT session.";
  }
  if (callerHint === "header_auth_candidate") {
    return "This tool call included an app auth header candidate. Header-auth /mcp mode may be viable for this connector path.";
  }
  if (callerHint === "cloudflare_access_candidate") {
    return "This request appears to include Cloudflare Access identity material, but the bridge is intentionally reporting presence only, not identity values.";
  }
  if (telemetry?.mcp_session === "missing") {
    return "The request did not include an MCP session id. This can be normal for initialize, but repeated missing sessions on tool calls explain Session terminated symptoms.";
  }
  return "No stable connector identity signal was observed beyond the MCP transport request.";
}

function connectorWhoamiNextAction(
  callerHint: ConnectorWhoamiResult["caller_classification_hint"],
  telemetry: RequestTelemetryContext | undefined
): string {
  if (callerHint === "tokenized_route") {
    return "Use the current rotated /t/[token]/mcp connector URL and treat it as a secret; if stale, update the connector URL.";
  }
  if (callerHint === "header_auth_candidate") {
    return "Consider testing /mcp header-auth mode in a fresh connector session.";
  }
  if (callerHint === "cloudflare_access_candidate") {
    return "If this identity is stable, consider moving access control to Cloudflare Access or a small broker.";
  }
  if (telemetry?.mcp_session === "missing") {
    return "Start a fresh ChatGPT connector session and retry repo_connector_whoami before runner-status calls.";
  }
  return "Keep tokenized connector mode or build a broker that injects stable auth on behalf of ChatGPT.";
}

export const visionRoutesHandler: ToolHandler = async (input, context) => safeTool<VisionRouteInput>("repo_vision_routes", input, context, async (args) => {
  context.registry.get(args.repo_id);
  const result = await new VisionRouteService().detect();
  const payload = { ...result, repo_id: args.repo_id };
  audit({
    tool: "repo_vision_routes",
    repo_id: args.repo_id,
    counts: { routes: payload.available_routes.length, missing: payload.missing_capabilities.length },
    warnings: payload.warnings
  });
  return createSuccessEnvelope(
    payload,
    payload.has_configured_vision_route
      ? "At least one configured vision route is available."
      : `No configured vision route is available. Missing: ${payload.missing_capabilities.join(", ")}.`,
    { warnings: payload.warnings }
  );
});

export const policyExplainHandler: ToolHandler = async (input, context) => safeTool<PolicyExplainInput>("repo_policy_explain", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = new PolicyExplainService(repo).explain(args);
  audit({
    tool: "repo_policy_explain",
    repo_id: args.repo_id,
    paths: result.path ? [result.path] : undefined,
    warnings: [result.read, result.write, result.cleanup].filter((decision) => !decision.allowed).map((decision) => decision.code)
  });
  return createSuccessEnvelope(result, result.summary);
});

export const lastWriteHandler: ToolHandler = async (input, context) => safeTool<LastWriteInput>("repo_last_write", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new OperationReceiptService(repo.root).readLastWrite(args.repo_id);
  audit({ tool: "repo_last_write", repo_id: args.repo_id, warnings: result.warnings });
  return createSuccessEnvelope(result, result.found ? `Last write receipt found for ${args.repo_id}.` : "No last write receipt found.");
});

export const treeHandler: ToolHandler = async (input, context) => safeTool<TreeOptions & RepoInput>("repo_tree", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const sandbox = new PathSandbox(repo.root);
  const result = await new RepoTreeService(repo.root, sandbox).tree(args);
  audit({ tool: "repo_tree", repo_id: args.repo_id, counts: { entries: result.entries.length }, truncated: result.truncated });
  return createSuccessEnvelope(result, `Returned ${result.entries.length} tree entries.`);
});

export const searchHandler: ToolHandler = async (input, context) => safeTool<SearchOptions & RepoInput>("repo_search", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const sandbox = new PathSandbox(repo.root);
  const result = await new SearchService(repo.root, sandbox).search(args);
  audit({ tool: "repo_search", repo_id: args.repo_id, counts: { results: result.returned_count }, truncated: result.truncated });
  return createSuccessEnvelope(result, `Returned ${result.returned_count} search results.`);
});

export const fetchFileHandler: ToolHandler = async (input, context) => safeTool<FetchFileOptions & RepoInput>("repo_fetch_file", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new FileReader(new PathSandbox(repo.root)).read(args);
  audit({ tool: "repo_fetch_file", repo_id: args.repo_id, paths: [result.path], counts: { bytes: result.size_bytes }, truncated: result.truncated, warnings: result.warnings });
  return createSuccessEnvelope(result, `Read ${result.path}.`, { warnings: result.warnings });
});

export const readManyHandler: ToolHandler = async (input, context) => safeTool<ReadManyInput>("repo_read_many", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const sandbox = new PathSandbox(repo.root);
  const result = await new ReadManyService(repo.root, sandbox, context.registry.limits).readMany(args);
  audit({ tool: "repo_read_many", repo_id: args.repo_id, paths: result.files.map((file) => file.path), counts: { returned: result.files.length, skipped: result.skipped.length }, truncated: result.truncated });
  return createSuccessEnvelope(result, `Read ${result.files.length} files; skipped ${result.skipped.length}.`);
});

export const gitStatusHandler: ToolHandler = async (input, context) => safeTool<RepoInput>("repo_git_status", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const [result, runnerStatus] = await Promise.all([
    new GitService(repo.root).status(),
    new AgentRunnerStatusService(repo.root).status({ repo_id: args.repo_id })
  ]);
  const resultWithRunnerStatus = {
    ...result,
    runner_status: runnerStatus
  };
  audit({ tool: "repo_git_status", repo_id: args.repo_id, counts: result.counts });
  const gitText = result.clean ? "Repository is clean." : `Repository has ${result.files.length} changed files.`;
  return createSuccessEnvelope(resultWithRunnerStatus, `${gitText}\n\n${runnerStatus.plain_text}`);
});

export const gitDiffHandler: ToolHandler = async (input, context) => safeTool<GitDiffInput>("repo_git_diff", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new GitService(repo.root).diff(args);
  audit({ tool: "repo_git_diff", repo_id: args.repo_id, paths: args.paths, counts: { files: result.files.length }, truncated: result.truncated, warnings: result.warnings });
  return createSuccessEnvelope(result, `Returned diff for ${result.files.length} files.`);
});

export const gitReviewHandler: ToolHandler = async (input, context) => safeTool<GitReviewInput>("repo_git_review", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new GitReviewService(repo.root, new OperationsPolicy(repo.operations)).review(args);
  audit({ tool: "repo_git_review", repo_id: args.repo_id, counts: { changed: result.changed_paths.length, recommended: result.recommendation.recommended_stage_paths.length }, truncated: result.diff_summary.truncated, warnings: result.recommendation.warnings });
  return createSuccessEnvelope(result, result.clean ? "Repository is clean." : `Reviewed ${result.changed_paths.length} changed paths.`);
});

export const gitStageHandler: ToolHandler = async (input, context) => safeTool<GitStageInput>("repo_git_stage", input, context, async (args) => {
  return gitStage("repo_git_stage", args, context);
});

export const writeStageHandler: ToolHandler = async (input, context) => safeTool<GitStageInput>("repo_write_stage", input, context, async (args) => {
  return gitStage("repo_write_stage", args, context);
});

async function gitStage(tool: "repo_git_stage" | "repo_write_stage", args: GitStageInput, context: RuntimeContext): Promise<CallToolResult> {
  const repo = context.registry.get(args.repo_id);
  const result = await new GitOperationsService(repo.root, new OperationsPolicy(repo.operations)).stage(args);
  audit({ tool, repo_id: args.repo_id, paths: result.staged_paths, warnings: result.warnings });
  return createSuccessEnvelope(result, result.dry_run ? `Dry run checked staging ${result.staged_paths.length} paths.` : `Staged ${result.staged_paths.length} paths.`);
}

export const gitUnstageHandler: ToolHandler = async (input, context) => safeTool<GitUnstageInput>("repo_git_unstage", input, context, async (args) => {
  return gitUnstage("repo_git_unstage", args, context);
});

export const writeUnstageHandler: ToolHandler = async (input, context) => safeTool<GitUnstageInput>("repo_write_unstage", input, context, async (args) => {
  return gitUnstage("repo_write_unstage", args, context);
});

async function gitUnstage(tool: "repo_git_unstage" | "repo_write_unstage", args: GitUnstageInput, context: RuntimeContext): Promise<CallToolResult> {
  const repo = context.registry.get(args.repo_id);
  const result = await new GitOperationsService(repo.root, new OperationsPolicy(repo.operations)).unstage(args);
  audit({ tool, repo_id: args.repo_id, paths: result.unstaged_paths, warnings: result.warnings });
  return createSuccessEnvelope(result, result.dry_run ? `Dry run checked unstaging ${result.unstaged_paths.length} paths.` : `Unstaged ${result.unstaged_paths.length} paths.`);
}

export const gitRestorePathsHandler: ToolHandler = async (input, context) => safeTool<GitRestorePathsInput>("repo_git_restore_paths", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new GitOperationsService(repo.root, new OperationsPolicy(repo.operations)).restorePaths(args);
  audit({ tool: "repo_git_restore_paths", repo_id: args.repo_id, paths: result.restored_paths, warnings: result.warnings });
  return createSuccessEnvelope(result, result.dry_run ? `Dry run checked restoring ${result.restored_paths.length} paths.` : `Restored ${result.restored_paths.length} paths.`);
});

export const gitCommitHandler: ToolHandler = async (input, context) => safeTool<GitCommitInput>("repo_git_commit", input, context, async (args) => {
  return gitCommit("repo_git_commit", args, context);
});

export const writeCommitHandler: ToolHandler = async (input, context) => safeTool<GitCommitInput>("repo_write_commit", input, context, async (args) => {
  return gitCommit("repo_write_commit", args, context);
});

export const writeStageCommitHandler: ToolHandler = async (input, context) => safeTool<GitStageCommitInput>("repo_write_stage_commit", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new GitOperationsService(repo.root, new OperationsPolicy(repo.operations)).stageCommit(args);
  audit({ tool: "repo_write_stage_commit", repo_id: args.repo_id, paths: result.committed_paths, warnings: result.warnings });
  return createSuccessEnvelope(result, result.dry_run ? `Dry run checked stage and commit for ${result.committed_paths.length} paths.` : `Staged and committed ${result.committed_paths.length} paths.`);
});

export const writeRecoverHandler: ToolHandler = async (input, context) => safeTool<GitRecoverInput>("repo_write_recover", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new GitOperationsService(repo.root, new OperationsPolicy(repo.operations)).recover(args);
  audit({
    tool: "repo_write_recover",
    repo_id: args.repo_id,
    paths: [...result.unstaged_paths, ...result.restored_paths, ...result.deleted.map((entry) => entry.path)],
    warnings: result.warnings
  });
  const recoveredCount = result.unstaged_paths.length + result.restored_paths.length + result.deleted.length;
  return createSuccessEnvelope(result, result.dry_run ? `Dry run checked recovery for ${recoveredCount} paths.` : `Recovered ${recoveredCount} paths.`);
});

async function gitCommit(tool: "repo_git_commit" | "repo_write_commit", args: GitCommitInput, context: RuntimeContext): Promise<CallToolResult> {
  const repo = context.registry.get(args.repo_id);
  const result = await new GitOperationsService(repo.root, new OperationsPolicy(repo.operations)).commit(args);
  audit({ tool, repo_id: args.repo_id, paths: result.committed_paths, warnings: result.warnings });
  return createSuccessEnvelope(result, result.dry_run ? `Dry run checked commit for ${result.committed_paths.length} paths.` : `Created local commit ${result.commit_sha}.`);
}

export const cleanupPathsHandler: ToolHandler = async (input, context) => safeTool<CleanupPathsInput>("repo_cleanup_paths", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new CleanupService(repo.root, new OperationsPolicy(repo.operations)).cleanup(args);
  audit({ tool: "repo_cleanup_paths", repo_id: args.repo_id, paths: result.deleted.map((entry) => entry.path), warnings: result.warnings });
  return createSuccessEnvelope(result, result.dry_run ? `Dry run checked cleanup for ${result.deleted.length} paths.` : `Cleaned up ${result.deleted.length} paths.`);
});

export const projectBriefHandler: ToolHandler = async (input, context) => safeTool<ProjectBriefInput>("repo_project_brief", input, context, async (args) => {
  const repoId = readOnlyRepoId(args.repo_id);
  const effectiveArgs = { ...args, repo_id: repoId };
  const repo = context.registry.get(repoId);
  const sandbox = new PathSandbox(repo.root);
  const result = await new ProjectBriefService(repo, sandbox).brief(effectiveArgs);
  audit({ tool: "repo_project_brief", repo_id: repoId, counts: { docs: result.key_docs.length, scripts: result.scripts.length }, truncated: result.truncated, warnings: result.warnings });
  return createSuccessEnvelope(result, `Returned project brief for ${repo.display_name}.`);
});

export const projectMemoryHandler: ToolHandler = async (input, context) => safeTool<ProjectMemoryInput>("repo_project_memory", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new ProjectMemoryService(repo, new PathSandbox(repo.root)).dashboard({
    include_archived: args.include_archived
  });
  audit({
    tool: "repo_project_memory",
    repo_id: args.repo_id,
    counts: {
      projects: result.project_count,
      roadmap: result.roadmap.length,
      paused: result.paused_ideas.length,
      watchlist: result.research_watchlist.length
    },
    warnings: result.warnings
  });
  const summary = result.project_count > 0
    ? `Project memory dashboard: ${result.project_count} projects, ${result.roadmap.length} roadmap items, ${result.paused_ideas.length} paused ideas.`
    : "Project memory dashboard is empty; seed .chatgpt/project-memory/projects.json.";
  return createSuccessEnvelope(result, summary, { warnings: result.warnings });
});

export const taskInventoryHandler: ToolHandler = async (input, context) => safeTool<TaskInventoryInput>("repo_task_inventory", input, context, async (args) => {
  const repoId = readOnlyRepoId(args.repo_id);
  const effectiveArgs = { ...args, repo_id: repoId };
  const repo = context.registry.get(repoId);
  const sandbox = new PathSandbox(repo.root);
  const result = await new TaskInventoryService(repo.root, sandbox).inventory(effectiveArgs);
  audit({ tool: "repo_task_inventory", repo_id: repoId, counts: { tasks: result.returned_count }, truncated: result.truncated, warnings: result.warnings });
  return createSuccessEnvelope(result, `Returned ${result.returned_count} task inventory items.`);
});

export const decisionMemoryHandler: ToolHandler = async (input, context) => safeTool<DecisionLogInput>("repo_decision_memory", input, context, async (args) => {
  const repoId = readOnlyRepoId(args.repo_id);
  const repo = context.registry.get(repoId);
  const sandbox = new PathSandbox(repo.root);
  const result = await new DecisionLogService(repo.root, sandbox).decisionLog({
    include_sources: args.include_sources
  });
  audit({ tool: "repo_decision_memory", repo_id: repoId, counts: { decisions: result.decisions.length, conventions: result.conventions.length }, warnings: result.warnings });
  return createSuccessEnvelope(result, `Returned ${result.decisions.length} decisions and ${result.conventions.length} conventions.`);
});

export const changePlanHandler: ToolHandler = async (input, context) => safeTool<ChangePlanInput>("repo_change_plan", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const sandbox = new PathSandbox(repo.root);
  const result = await new ChangePlanService(repo.root, sandbox).plan({
    goal: args.goal,
    include_globs: args.include_globs,
    max_files_to_inspect: args.max_files_to_inspect,
    planning_depth: args.planning_depth
  });
  audit({ tool: "repo_change_plan", repo_id: args.repo_id, counts: { relevant_files: result.relevant_files.length, steps: result.proposed_steps.length }, warnings: result.warnings });
  return createSuccessEnvelope(result, `Returned change plan with ${result.proposed_steps.length} steps.`);
});

export const nextActionHandler: ToolHandler = async (input, context) => safeTool<NextActionInput>("repo_next_action", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const sandbox = new PathSandbox(repo.root);
  const result = await new NextActionService(repo, sandbox).recommend({
    mode: args.mode,
    horizon: args.horizon
  });
  audit({ tool: "repo_next_action", repo_id: args.repo_id, counts: { actions: result.suggested_actions.length, blockers: result.blockers.length }, warnings: result.warnings });
  return createSuccessEnvelope(result, result.recommendation);
});

export const planReviewHandler: ToolHandler = async (input) => {
  const args = z.object({ prompt: z.string().min(1) }).parse(input);
  const result = new ReviewPlanner().plan(args.prompt);
  return createSuccessEnvelope(result, `Recommended next tool: ${result.recommended_next_tools[0]}.`);
};

export const prepareCodexTaskHandler: ToolHandler = async (input, context) => safeTool<CodexTaskInput>("repo_prepare_codex_task", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = new CodexTaskService(repo.root, new PathSandbox(repo.root), new WritePolicy(repo.writes)).prepare(args);
  audit({ tool: "repo_prepare_codex_task", repo_id: args.repo_id, paths: [result.prompt_path, result.result_path], warnings: result.warnings });
  return createSuccessEnvelope(result, `Prepared Codex task ${result.run_id}.`);
});

export const writeCodexTaskHandler: ToolHandler = async (input, context) => safeTool<CodexTaskWriteInput>("repo_write_codex_task", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const headShaBefore = await readHeadSha(repo.root);
  const result = await new CodexTaskService(repo.root, new PathSandbox(repo.root), new WritePolicy(repo.writes)).write(args);
  if (!result.dry_run && result.written_paths.length > 0) {
    const headShaAfter = await readHeadSha(repo.root);
    const receipt = await new OperationReceiptService(repo.root).writeLastWrite({
      tool: "repo_write_codex_task",
      repo_id: args.repo_id,
      ...(headShaBefore ? { head_sha_before: headShaBefore } : {}),
      ...(headShaAfter ? { head_sha_after: headShaAfter } : {}),
      touched_paths: result.written_paths,
      changed_paths: result.written_paths,
      created_paths: result.written_paths,
      modified_paths: [],
      counts: {
        requested: result.written_paths.length,
        changed: result.written_paths.length,
        created: result.written_paths.length,
        unchanged: 0
      },
      summary: `Queued Codex task ${result.run_id}.`
    });
    const resultWithReceipt = {
      ...result,
      warnings: [...result.warnings, ...receipt.warnings],
      ...(receipt.operation_receipt ? { operation_receipt: receipt.operation_receipt } : {})
    };
    audit({ tool: "repo_write_codex_task", repo_id: args.repo_id, paths: resultWithReceipt.written_paths, warnings: resultWithReceipt.warnings });
    return createSuccessEnvelope(
      resultWithReceipt,
      `Queued Codex task ${resultWithReceipt.run_id}.`,
      { warnings: resultWithReceipt.warnings }
    );
  }
  audit({ tool: "repo_write_codex_task", repo_id: args.repo_id, paths: result.written_paths, warnings: result.warnings });
  return createSuccessEnvelope(
    result,
    result.dry_run ? `Dry run checked Codex task ${result.run_id}.` : `Wrote Codex task ${result.run_id}.`,
    { warnings: result.warnings }
  );
});

export const writeCodexTasksBatchHandler: ToolHandler = async (input, context) => safeTool<CodexTaskBatchWriteInput>("repo_write_codex_tasks_batch", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const headShaBefore = await readHeadSha(repo.root);
  const result = await new CodexTaskService(repo.root, new PathSandbox(repo.root), new WritePolicy(repo.writes)).writeBatch(args);
  if (!result.dry_run && result.written_paths.length > 0) {
    const headShaAfter = await readHeadSha(repo.root);
    const receipt = await new OperationReceiptService(repo.root).writeLastWrite({
      tool: "repo_write_codex_tasks_batch",
      repo_id: args.repo_id,
      ...(headShaBefore ? { head_sha_before: headShaBefore } : {}),
      ...(headShaAfter ? { head_sha_after: headShaAfter } : {}),
      touched_paths: result.written_paths,
      changed_paths: result.written_paths,
      created_paths: result.written_paths,
      modified_paths: [],
      counts: {
        requested: result.written_paths.length,
        changed: result.written_paths.length,
        created: result.written_paths.length,
        unchanged: 0
      },
      summary: `Queued ${result.created_run_ids.length} Codex task seeds.`
    });
    const resultWithReceipt = {
      ...result,
      warnings: [...result.warnings, ...receipt.warnings],
      ...(receipt.operation_receipt ? { operation_receipt: receipt.operation_receipt } : {})
    };
    audit({ tool: "repo_write_codex_tasks_batch", repo_id: args.repo_id, paths: resultWithReceipt.written_paths, warnings: resultWithReceipt.warnings });
    return createSuccessEnvelope(
      resultWithReceipt,
      `Queued ${resultWithReceipt.created_run_ids.length} Codex task seeds: ${resultWithReceipt.created_run_ids.join(", ")}.`,
      { warnings: resultWithReceipt.warnings }
    );
  }
  audit({ tool: "repo_write_codex_tasks_batch", repo_id: args.repo_id, paths: result.written_paths, warnings: result.warnings });
  const summary = result.rejected.length > 0
    ? `Rejected Codex task batch before writing: ${result.rejected.length} rejected.`
    : result.dry_run
      ? `Dry run checked ${result.created_run_ids.length} Codex task seeds.`
      : `Wrote ${result.created_run_ids.length} Codex task seeds.`;
  return createSuccessEnvelope(result, summary, { warnings: result.warnings });
});

export const codexReviewHandler: ToolHandler = async (input, context) => safeTool<CodexReviewInput>("repo_codex_review", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new CodexResultService(
    new PathSandbox(repo.root),
    new GitReviewService(repo.root, new OperationsPolicy(repo.operations))
  ).review(args);
  audit({
    tool: "repo_codex_review",
    repo_id: args.repo_id,
    paths: [result.result_path],
    counts: result.git_review ? { changed: result.git_review.changed_paths.length } : undefined,
    warnings: result.warnings
  });
  return createSuccessEnvelope(
    result,
    result.result_found ? `Reviewed Codex result ${result.run_id}.` : `Codex result missing for ${result.run_id}.`,
    { warnings: result.warnings }
  );
});

export const codexRunAndWaitHandler: ToolHandler = async (input, context) => safeTool<CodexRunAndWaitInput>("codex_run_and_wait", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new CodexRunService(repo.root).runAndWait(args);
  audit({
    tool: "codex_run_and_wait",
    repo_id: args.repo_id,
    paths: [result.prompt_path, result.result_path, result.lock_path],
    warnings: result.warnings
  });
  return createSuccessEnvelope(
    result,
    result.status === "completed" || result.status === "existing_result"
      ? `Codex result available for ${result.run_id}.`
      : `Codex run ${result.run_id} returned status ${result.status}.`,
    { warnings: result.warnings }
  );
});

export const labExecHandler: ToolHandler = async (input, context) => safeTool<LabExecInput>("repo_lab_exec", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new LabExecService(repo.root).run(args);
  audit({
    tool: "repo_lab_exec",
    repo_id: args.repo_id,
    paths: result.argv.length > 1 ? [result.argv[1]!] : [],
    counts: { spawned: result.spawned ? 1 : 0 },
    warnings: result.warnings
  });
  const summary = result.status === "rejected"
    ? `Lab command rejected before spawn: ${result.policy.rejection_reasons.join("; ")}`
    : `Lab command ${result.status}: exit=${result.exit_code ?? "null"} duration_ms=${result.duration_ms}.`;
  return createSuccessEnvelope(result, summary, { warnings: result.warnings });
});

export const townPortalReturnHandler: ToolHandler = async (input, context) => safeTool<TownPortalReturnInput>("repo_town_portal_return", input, context, async () => {
  const args = TownPortalReturnInputSchema.parse(input ?? {});
  const modeCount = (args.lab_mode === "town_portal_advisory_v0" ? 1 : 0) + (args.production_mode === "town_portal_production_v0" ? 1 : 0);
  if (modeCount !== 1) {
    throw new Error("Specify exactly one Town Portal return mode: lab_mode or production_mode.");
  }
  const repo = context.registry.get(args.repo_id);
  const serviceOptions = args.production_mode === "town_portal_production_v0"
    ? {
        repoRoot: repo.root,
        productionConsumptionStore: new TownPortalConsumptionStore(`${repo.root}/shared/portals/production-consumptions`)
      }
    : {
        repoRoot: repo.root,
        consumedPortalIds: getLabTownPortalConsumedIds(repo.root)
      };
  const result = await TownPortalReturnService.withKnowledgeDisplayAdapter(serviceOptions).returnToPortal(args);
  audit({
    tool: "repo_town_portal_return",
    repo_id: args.repo_id,
    paths: result.handoff ? [result.handoff.target_path] : [],
    warnings: result.status === "accepted" ? [] : [result.reason]
  });
  const summary = result.status === "accepted"
    ? `Town Portal return accepted for ${result.handoff?.target_path}.`
    : `Town Portal return ${result.status}: ${result.reason}.`;
  return createSuccessEnvelope(result, summary, {
    warnings: result.status === "accepted" ? [] : [result.reason]
  });
});

function getLabTownPortalConsumedIds(repoRoot: string): Set<string> {
  let consumedPortalIds = townPortalConsumedIdsByRepoRoot.get(repoRoot);
  if (!consumedPortalIds) {
    consumedPortalIds = new Set();
    townPortalConsumedIdsByRepoRoot.set(repoRoot, consumedPortalIds);
  }
  return consumedPortalIds;
}

export const writeFileHandler: ToolHandler = async (input, context) => safeTool<WriteFileInput>("repo_write_file", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const sandbox = new PathSandbox(repo.root);
  const headShaBefore = await readHeadSha(repo.root);
  const result = await new FileWriter(repo.root, sandbox, new WritePolicy(repo.writes)).write(args);
  if (!result.dry_run && result.changed) {
    const headShaAfter = await readHeadSha(repo.root);
    const receipt = await new OperationReceiptService(repo.root).writeLastWrite({
      tool: "repo_write_file",
      repo_id: args.repo_id,
      ...(headShaBefore ? { head_sha_before: headShaBefore } : {}),
      ...(headShaAfter ? { head_sha_after: headShaAfter } : {}),
      touched_paths: [result.path],
      changed_paths: [result.path],
      created_paths: result.created ? [result.path] : [],
      modified_paths: result.created ? [] : [result.path],
      counts: {
        requested: 1,
        changed: 1,
        created: result.created ? 1 : 0,
        unchanged: 0
      },
      summary: result.summary
    });
    const resultWithReceipt = {
      ...result,
      warnings: [...result.warnings, ...receipt.warnings],
      ...(receipt.operation_receipt ? { operation_receipt: receipt.operation_receipt } : {})
    };
    audit({ tool: "repo_write_file", repo_id: args.repo_id, paths: [resultWithReceipt.path], counts: { bytes: resultWithReceipt.bytes_written }, warnings: resultWithReceipt.warnings });
    return createSuccessEnvelope(resultWithReceipt, resultWithReceipt.dry_run ? `Dry run checked write to ${resultWithReceipt.path}.` : `Wrote ${resultWithReceipt.path}.`, { warnings: resultWithReceipt.warnings });
  }
  audit({ tool: "repo_write_file", repo_id: args.repo_id, paths: [result.path], counts: { bytes: result.bytes_written }, warnings: result.warnings });
  return createSuccessEnvelope(result, result.dry_run ? `Dry run checked write to ${result.path}.` : `Wrote ${result.path}.`, { warnings: result.warnings });
});

export const writeChangesHandler: ToolHandler = async (input, context) => safeTool<WriteChangesInput>("repo_write_changes", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const sandbox = new PathSandbox(repo.root);
  const headShaBefore = await readHeadSha(repo.root);
  const result = await new WriteChangesService(repo.root, sandbox, new WritePolicy(repo.writes)).apply(args);
  if (!result.dry_run && result.changed_paths.length > 0) {
    const headShaAfter = await readHeadSha(repo.root);
    const receipt = await new OperationReceiptService(repo.root).writeLastWrite({
      tool: "repo_write_changes",
      repo_id: args.repo_id,
      ...(headShaBefore ? { head_sha_before: headShaBefore } : {}),
      ...(headShaAfter ? { head_sha_after: headShaAfter } : {}),
      touched_paths: result.files.map((file) => file.path),
      changed_paths: result.changed_paths,
      created_paths: result.files.filter((file) => file.changed && file.created).map((file) => file.path),
      modified_paths: result.files.filter((file) => file.changed && !file.created).map((file) => file.path),
      counts: result.counts,
      summary: result.summary
    });
    const resultWithReceipt = {
      ...result,
      warnings: [...result.warnings, ...receipt.warnings],
      ...(receipt.operation_receipt ? { operation_receipt: receipt.operation_receipt } : {})
    };
    audit({ tool: "repo_write_changes", repo_id: args.repo_id, paths: resultWithReceipt.changed_paths, counts: resultWithReceipt.counts, warnings: resultWithReceipt.warnings });
    return createSuccessEnvelope(resultWithReceipt, resultWithReceipt.dry_run ? `Dry run checked ${resultWithReceipt.files.length} changes.` : resultWithReceipt.summary, { warnings: resultWithReceipt.warnings });
  }
  audit({ tool: "repo_write_changes", repo_id: args.repo_id, paths: result.changed_paths, counts: result.counts, warnings: result.warnings });
  return createSuccessEnvelope(result, result.dry_run ? `Dry run checked ${result.files.length} changes.` : result.summary, { warnings: result.warnings });
});

export const writeHandoffHandler: ToolHandler = async (input, context) => safeTool<HandoffInput>("repo_write_handoff", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new HandoffService(
    repo.root,
    new PathSandbox(repo.root),
    new WritePolicy(repo.writes),
    new GitService(repo.root)
  ).write(args);
  audit({
    tool: "repo_write_handoff",
    repo_id: args.repo_id,
    paths: result.current_path ? [result.handoff_path, result.current_path] : [result.handoff_path],
    warnings: result.warnings
  });
  return createSuccessEnvelope(
    result,
    result.dry_run ? `Dry run checked handoff ${result.handoff_path}.` : `Wrote handoff ${result.handoff_path}.`,
    { warnings: result.warnings }
  );
});

async function safeTool<TInput extends Record<string, unknown>>(
  tool: string,
  input: unknown,
  context: RuntimeContext,
  run: (args: TInput) => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    const result = await run(input as TInput);
    context.diagnostics?.recordSuccess();
    return result;
  } catch (error) {
    const repoError = toRepoReaderError(error);
    context.diagnostics?.recordToolError({
      error_type: repoError.code,
      error_message: repoError.message
    });
    audit({ tool, repo_id: typeof input === "object" && input && "repo_id" in input ? String(input.repo_id) : undefined, warnings: [repoError.code] });
    return createErrorEnvelope(repoError);
  }
}

function readOnlyRepoId(repoId: string | undefined): string {
  return repoId && repoId.trim().length > 0 ? repoId : "shared-agent-bridge";
}

type CapabilitySummaryResult = Awaited<ReturnType<typeof buildCapabilitySummary>>;

async function capabilitySummaryForResponse(
  summary: CapabilitySummaryResult,
  options: { detail: "summary" | "full"; capabilityId?: string; portalId?: string; repoRoot?: string; runnerStatusSurface?: boolean }
) {
  const capabilityId = normalizeCapabilityId(options.capabilityId);
  if (capabilityId) {
    return focusedCapabilitySummary(summary, capabilityId, options);
  }
  if (options.detail === "full") {
    return {
      expansion: {
        mode: "full",
        detail: "full",
        focused: false,
        full_detail_hint: "Full capability diagnostics included."
      },
      ...summary
    };
  }
  return skeletalCapabilitySummary(summary, options.runnerStatusSurface === true);
}

function skeletalCapabilitySummary(summary: CapabilitySummaryResult, runnerStatusSurface: boolean) {
  const tocCapabilities = summary.capability_toc.capabilities.map((entry) => ({
    capability_id: entry.capability_id,
    status: entry.status
  }));
  const moduleHandles = summary.module_registry.modules.map((entry) => ({
    module_id: entry.module_id,
    status: entry.status,
    class: entry.class
  }));
  const base = {
    expansion: {
      mode: "skeletal",
      detail: "summary",
      focused: false,
      full_detail_hint: "Pass capability_id for one focused capability, or detail: \"full\" for full diagnostics."
    },
    bridge_compass: summary.bridge_compass,
    concierge_preflight: summary.concierge_preflight,
    capability_toc: {
      state: summary.capability_toc.state,
      capability_count: summary.capability_toc.capability_count,
      returned_count: tocCapabilities.length,
      capabilities: tocCapabilities,
      ...(summary.capability_toc.blocker ? { blocker: summary.capability_toc.blocker } : {})
    },
    module_registry: {
      state: summary.module_registry.state,
      module_count: summary.module_registry.module_count,
      returned_count: moduleHandles.length,
      modules: moduleHandles,
      ...(summary.module_registry.blocker ? { blocker: summary.module_registry.blocker } : {})
    }
  };
  if (runnerStatusSurface) {
    return base;
  }
  return {
    ...base,
    states: {
      codex_handoff: summary.codex_handoff.state,
      runner: summary.runner.state,
      durable_queue: summary.durable_queue.state,
      event_inbox: summary.event_inbox.state,
      image_assets: summary.image_assets.state,
      vision_route_detection: summary.vision_route_detection.state,
      latest_validation: summary.latest_validation.state,
      git_review: summary.git_review.state,
      git_stage_commit: summary.git_stage_commit.state
    }
  };
}

async function focusedCapabilitySummary(
  summary: CapabilitySummaryResult,
  capabilityId: string,
  options: { portalId?: string; repoRoot?: string }
) {
  const capability = summary.capability_toc.capabilities.find((entry) => entry.capability_id === capabilityId);
  const moduleHandles = summary.module_registry.modules.map((entry) => ({
    module_id: entry.module_id,
    status: entry.status,
    class: entry.class
  }));
  const townPortalSurface = capabilityId === "town_portal" && options.repoRoot
    ? await new PortalInboxService(options.repoRoot).read({ portal_id: options.portalId })
    : undefined;
  return {
    expansion: {
      mode: "focused",
      detail: "capability_id",
      focused: true,
      capability_id: capabilityId,
      found: Boolean(capability),
      full_detail_hint: "This focused response expands one named capability. Use detail: \"full\" without capability_id for full diagnostics."
    },
    bridge_compass: summary.bridge_compass,
    ...(capabilityId === "concierge_style_routing" ? { concierge_preflight: summary.concierge_preflight } : {}),
    capability_toc: {
      state: capability ? summary.capability_toc.state : "blocked",
      source_path: summary.capability_toc.source_path,
      generated_at: summary.capability_toc.generated_at,
      capability_count: summary.capability_toc.capability_count,
      returned_count: capability ? 1 : 0,
      capabilities: capability ? [capability] : [],
      ...(capability ? {} : { blocker: `Capability id not found: ${capabilityId}` })
    },
    module_registry: {
      state: summary.module_registry.state,
      module_count: summary.module_registry.module_count,
      returned_count: moduleHandles.length,
      modules: moduleHandles,
      ...(summary.module_registry.blocker ? { blocker: summary.module_registry.blocker } : {})
    },
    ...(townPortalSurface ? { town_portal_surface: townPortalSurface } : {})
  };
}

function normalizeCapabilityId(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readHeadSha(root: string): Promise<string | undefined> {
  try {
    return (await new GitService(root).status()).head_sha;
  } catch {
    return undefined;
  }
}

function redactSecretLike(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b(?:api[_-]?key|token|secret)=\S+/gi, "$1=[REDACTED_SECRET]");
}
