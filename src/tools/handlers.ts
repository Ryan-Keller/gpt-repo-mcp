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
import { HermesKanbanStatusService } from "../services/hermes-kanban-status-service.js";
import { HermesSupervisionService } from "../services/hermes-supervision-service.js";
import { HermesCancelService } from "../services/hermes-cancel-service.js";
import { HermesKanbanCommandService } from "../services/hermes-kanban-command-service.js";
import { HermesIntakeService } from "../services/hermes-intake-service.js";
import { LabExecService } from "../services/lab-exec-service.js";
import { TownPortalConsumptionStore } from "../services/town-portal-consumption-store.js";
import { TownPortalReturnService } from "../services/town-portal-return-service.js";
import { OperationsPolicy } from "../services/operations-policy.js";
import { ReviewPlanner } from "../services/review-planner.js";
import { ReadManyService } from "../services/read-many-service.js";
import { ProjectBriefService } from "../services/project-brief-service.js";
import { ProjectMemoryService } from "../services/project-memory-service.js";
import { PortfolioReportService } from "../services/portfolio-report-service.js";
import { PortfolioActionLedgerService } from "../services/portfolio-action-ledger-service.js";
import { PortfolioExecutionService } from "../services/portfolio-execution-service.js";
import { GoalRecordService } from "../services/goal-record-service.js";
import { DecisionBundleService, IdeaInboxService } from "../services/portfolio-intake-service.js";
import { PortfolioConsoleStateService } from "../services/portfolio-console-state-service.js";
import { TaskInventoryService } from "../services/task-inventory-service.js";
import { VisionRouteService, buildVisionAnalysisFallback } from "../services/vision-route-service.js";
import { buildCapabilitySummary } from "../services/capability-summary-service.js";
import { PortalInboxService } from "../services/portal-inbox-service.js";
import { DecisionLogService } from "../services/decision-log-service.js";
import { ChangePlanService } from "../services/change-plan-service.js";
import { CodexResultService } from "../services/codex-result-service.js";
import { CodexAppserverTurnService } from "../services/codex-appserver-turn-service.js";
import { CodexRunService } from "../services/codex-run-service.js";
import { CodexTaskService } from "../services/codex-task-service.js";
import { NextActionService } from "../services/next-action-service.js";
import { PolicyExplainService } from "../services/policy-explain-service.js";
import { FileWriter } from "../services/file-writer.js";
import { WriteChangesService } from "../services/write-changes-service.js";
import { WritePolicy } from "../services/write-policy.js";
import { OperationReceiptService } from "../services/operation-receipt-service.js";
import { createErrorEnvelope, createSuccessEnvelope } from "../runtime/result-envelope.js";
import { RepoReaderError, toRepoReaderError } from "../runtime/errors.js";
import { audit, getRequestTelemetry, type RequestTelemetryContext } from "../runtime/telemetry.js";
import { getConnectorDiagnostics } from "../runtime/connector-session.js";
import { buildConnectorIdentitySnapshot } from "../runtime/connector-identity.js";
import type { RuntimeContext } from "../runtime/context.js";
import type { AgentRunnerStatusInput, AgentRunnerStatusResult, RunLiveTailInput } from "../contracts/agent-runner.contract.js";
import type { BridgeConciergeInput } from "../contracts/bridge-concierge.contract.js";
import type { SearchOptions } from "../services/search-service.js";
import type { FetchFileOptions } from "../services/file-reader.js";
import type { TreeOptions } from "../services/repo-tree-service.js";
import type { ProjectBriefInput } from "../contracts/project.contract.js";
import type { ProjectMemoryInput } from "../contracts/project-memory.contract.js";
import type { PortfolioReportInput } from "../contracts/portfolio-report.contract.js";
import type { CodexFollowupReceipt, GoalReviewDecision, PortfolioActionCommandInput } from "../contracts/portfolio-action.contract.js";
import type { GoalRecord } from "../contracts/goal-record.contract.js";
import type { TaskInventoryInput } from "../contracts/task.contract.js";
import type { DecisionLogInput } from "../contracts/decision.contract.js";
import type { ChangePlanInput } from "../contracts/change-plan.contract.js";
import type { CodexReviewInput, CodexRunAndWaitInput, CodexTaskBatchWriteInput, CodexTaskInput, CodexTaskWriteInput } from "../contracts/codex-task.contract.js";
import type { CodexAppserverTurnInput } from "../contracts/codex-appserver.contract.js";
import type { NextActionInput } from "../contracts/next-action.contract.js";
import type { VisionRouteInput } from "../contracts/vision-route.contract.js";
import type { LastWriteInput } from "../contracts/operation-receipt.contract.js";
import type { PolicyExplainInput } from "../contracts/policy.contract.js";
import { RepoProjectContextInputSchema, type RepoProjectContextInput } from "../contracts/project-context.contract.js";
import { RepoReadInputSchema, type RepoReadInput } from "../contracts/read-hub.contract.js";
import type { WriteChangesInput, WriteFileInput } from "../contracts/write.contract.js";
import type { GitCommitInput, GitRecoverInput, GitRestorePathsInput, GitStageCommitInput, GitStageInput, GitUnstageInput } from "../contracts/git-operations.contract.js";
import type { GitReviewInput } from "../contracts/git-review.contract.js";
import type { CleanupPathsInput } from "../contracts/cleanup.contract.js";
import type { HandoffInput } from "../contracts/handoff.contract.js";
import type { HermesIntakeInput } from "../contracts/hermes-intake.contract.js";
import type { HermesCancelInput, HermesInterventionInput, HermesKanbanCommandInput } from "../contracts/hermes-supervision.contract.js";
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
const CENTRAL_CODEX_QUEUE_REPO_ID = "shared-agent-bridge";
type RegisteredRepo = ReturnType<RuntimeContext["registry"]["get"]>;

const RepoListRootsInput = z.object({
  capability_id: z.string().min(1).optional(),
  portal_id: z.string().min(1).optional(),
  hermes_board: z.string()
    .min(3)
    .max(160)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    .optional(),
  hermes_transaction: z.string().regex(/^offthread-[a-f0-9]{16}$/).optional(),
  hermes_cursor: z.string().max(240).optional(),
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
      effectiveRunnerStatusForRepo(context, repo, { repo_id: repo.repo_id, detail }),
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
        hermesBoard: args.hermes_board,
        hermesTransaction: args.hermes_transaction,
        hermesCursor: args.hermes_cursor,
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
    effectiveRunnerStatusForRepo(context, repo, args),
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
    ...(result.central_queue ? { central_queue: result.central_queue } : {}),
    plain_text: result.plain_text,
    warnings: result.warnings,
    capability_summary: await capabilitySummaryForResponse(capabilitySummary, {
      detail: result.detail_level,
      capabilityId: args.capability_id,
      portalId: args.portal_id,
      hermesBoard: args.hermes_board,
      hermesTransaction: args.hermes_transaction,
      hermesCursor: args.hermes_cursor,
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

export const connectorWhoamiHandler: ToolHandler = async () => {
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

export const repoReadHandler: ToolHandler = async (input, context) => safeTool<RepoReadInput>("repo_read", input, context, async (rawArgs) => {
  const args = RepoReadInputSchema.parse(rawArgs);
  const repo = context.registry.get(args.repo_id);
  const sandbox = new PathSandbox(repo.root);

  if (args.mode === "tree") {
    const result = await new RepoTreeService(repo.root, sandbox).tree({
      path: args.path,
      max_depth: args.max_depth,
      page_size: args.page_size,
      include_files: args.include_files,
      respect_default_excludes: args.respect_default_excludes,
      include_generated: args.include_generated,
      include_dependencies: args.include_dependencies,
      cursor: args.cursor
    });
    audit({ tool: "repo_read", repo_id: args.repo_id, counts: { entries: result.entries.length }, truncated: result.truncated });
    return createSuccessEnvelope(
      { ok: true as const, mode: args.mode, delegated_tool: "repo_tree" as const, result, warnings: [] },
      `repo_read tree returned ${result.entries.length} entries.`
    );
  }

  if (args.mode === "search") {
    if (!args.query) {
      throw new Error("repo_read search mode requires query.");
    }
    const result = await new SearchService(repo.root, sandbox).search({
      query: args.query,
      mode: args.search_mode,
      include_globs: args.include_globs,
      exclude_globs: args.exclude_globs,
      context_lines: args.context_lines,
      max_results: args.max_results,
      cursor: args.cursor
    });
    audit({ tool: "repo_read", repo_id: args.repo_id, counts: { results: result.returned_count }, truncated: result.truncated, warnings: result.warnings });
    return createSuccessEnvelope(
      { ok: true as const, mode: args.mode, delegated_tool: "repo_search" as const, result, warnings: result.warnings },
      `repo_read search returned ${result.returned_count} results.`,
      { warnings: result.warnings }
    );
  }

  if (args.mode === "file") {
    if (!args.path) {
      throw new Error("repo_read file mode requires path.");
    }
    const result = await new FileReader(new PathSandbox(repo.root)).read({
      path: args.path,
      start_line: args.start_line,
      end_line: args.end_line,
      max_bytes: args.max_bytes,
      override_default_excludes: args.override_default_excludes
    });
    audit({ tool: "repo_read", repo_id: args.repo_id, paths: [result.path], counts: { bytes: result.size_bytes }, truncated: result.truncated, warnings: result.warnings });
    return createSuccessEnvelope(
      { ok: true as const, mode: args.mode, delegated_tool: "repo_fetch_file" as const, result, warnings: result.warnings },
      `repo_read file read ${result.path}.`,
      { warnings: result.warnings }
    );
  }

  if ((args.paths?.length ?? 0) === 0 && (args.include_globs?.length ?? 0) === 0) {
    throw new Error("repo_read many mode requires paths or include_globs.");
  }
  const result = await new ReadManyService(repo.root, sandbox, context.registry.limits).readMany({
    paths: args.paths,
    include_globs: args.include_globs,
    exclude_globs: args.exclude_globs,
    max_files: args.max_files,
    max_bytes_per_file: args.max_bytes_per_file,
    max_total_bytes: args.max_total_bytes,
    cursor: args.cursor
  });
  audit({ tool: "repo_read", repo_id: args.repo_id, paths: result.files.map((file) => file.path), counts: { returned: result.files.length, skipped: result.skipped.length }, truncated: result.truncated });
  return createSuccessEnvelope(
    { ok: true as const, mode: args.mode, delegated_tool: "repo_read_many" as const, result, warnings: [] },
    `repo_read many read ${result.files.length} files; skipped ${result.skipped.length}.`
  );
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

export const portfolioReportHandler: ToolHandler = async (input, context) => safeTool<PortfolioReportInput>("repo_portfolio_report", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const memory = await new ProjectMemoryService(repo, new PathSandbox(repo.root)).dashboard({ include_archived: false });
  const ledger = await new PortfolioActionLedgerService(repo.root).read();
  const consoleState = await new PortfolioConsoleStateService(repo.root).read();
  const goals = await new GoalRecordService(repo.root).read();
  const ideas = args.repo_id === "shared-agent-bridge" ? await new IdeaInboxService(repo.root).latest() : [];
  const result = new PortfolioReportService().build(args.repo_id, memory, {
    topics: args.topics, project_ids: args.project_ids, include_paused: args.include_paused, max_actions: args.max_actions, cursor: args.cursor
  }, ledger, consoleState, context.registry.list().map((item) => item.repo_id), goals, ideas);
  audit({ tool: "repo_portfolio_report", repo_id: args.repo_id, counts: { projects: result.projects.length, actions: result.actions.length }, warnings: result.warnings });
  return createSuccessEnvelope(result, result.summary, { warnings: result.warnings });
});

export const portfolioActionCommandHandler: ToolHandler = async (input, context) => safeTool<PortfolioActionCommandInput>("repo_portfolio_action_command", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const goalService = new GoalRecordService(repo.root);
  if (args.operation === "capture_idea" || args.operation === "update_idea") {
    if (args.repo_id !== "shared-agent-bridge") throw new RepoReaderError("VALIDATION_ERROR", "Idea Inbox is owned by repo_id shared-agent-bridge.");
    const idea = await new IdeaInboxService(repo.root).capture(args.idea!); const observedAt = new Date().toISOString();
    const result = { ok: true, repo_id: args.repo_id, operation: args.operation, changed_count: 1, unchanged_count: 0,
      entries: [], recent_activity: [], observed_at: observedAt, ledger_path: ".chatgpt/portfolio-action-ledger.json", storage_path: "shared/ideas/inbox.jsonl",
      idea_records: [idea], warnings: [], next_action: idea.status === "ready_for_slice" ? "promote_to_portfolio_suggestion_or_goal_when_approved" : "keep_in_local_idea_inbox" };
    return createSuccessEnvelope(result, `Idea ${idea.idea_id} recorded as ${idea.status}.`);
  }
  if (args.operation === "route_bundle" || args.operation === "cancel_bundle") {
    const service = new DecisionBundleService(repo.root);
    const bundle = args.operation === "cancel_bundle"
      ? await service.cancel(args.bundle!.bundle_id ?? "", args.reason ?? "Cancelled by operator.")
      : await service.create(args.bundle!, args.actions.map((action) => action.action_id));
    if (!bundle) throw new RepoReaderError("VALIDATION_ERROR", "Decision bundle not found.");
    const result = { ok: true, repo_id: args.repo_id, operation: args.operation, changed_count: 1, unchanged_count: 0,
      entries: [], recent_activity: [], observed_at: bundle.updated_at, ledger_path: ".chatgpt/portfolio-action-ledger.json", storage_path: ".chatgpt/decision-bundles-v1.json",
      decision_bundles: [bundle], warnings: [], next_action: bundle.state === "cancelled" ? "preserve_receipts_and_refresh_portfolio" : "route_bundle_actions_by_dependency_wave" };
    return createSuccessEnvelope(result, `Decision bundle ${bundle.bundle_id} is ${bundle.state}.`);
  }
  if (args.operation === "register_codex" || args.operation === "update_goal") {
    const goal = args.goal_review
      ? await goalService.recordReviewDecision(args.goal!, args.goal_review)
      : await goalService.upsert(args.goal!);
    const warnings: string[] = [];
    const codexFollowups: CodexFollowupReceipt[] = [];
    if (args.goal_review?.create_codex_followup) {
      if (goal.executor !== "codex") {
        warnings.push("GOAL_REVIEW_CODEX_FOLLOWUP_SKIPPED_NON_CODEX_EXECUTOR");
      } else {
        const followup = await queueGoalReviewCodexFollowup(context, goal, args.goal_review, args.reason);
        codexFollowups.push(followup);
        warnings.push(...followup.warnings);
      }
    }
    const observedAt = new Date().toISOString();
    const nextAction = codexFollowups.length > 0
      ? "review_decision_recorded_and_codex_followup_queued; inspect_repo_runner_status_on_shared_agent_bridge"
      : args.goal_review
        ? "review_decision_recorded; refresh_repo_portfolio_report_to_verify_goal_timeline"
        : "refresh_repo_portfolio_report_to_verify_goal_timeline";
    const result = {
      ok: true, repo_id: args.repo_id, operation: args.operation, changed_count: 1, unchanged_count: 0,
      entries: [], recent_activity: [], observed_at: observedAt,
      ledger_path: ".chatgpt/portfolio-action-ledger.json", storage_path: ".chatgpt/goal-records-v1.json",
      goal_records: [goal], codex_followup_receipts: codexFollowups, warnings, next_action: nextAction
    };
    audit({ tool: "repo_portfolio_action_command", repo_id: args.repo_id, counts: { changed: 1, unchanged: 0 }, warnings });
    const summary = args.goal_review
      ? `${goal.executor} goal ${goal.goal_id} recorded Field Console ${args.goal_review.decision.toUpperCase()}${codexFollowups.length > 0 ? ` and queued ${codexFollowups[0]!.run_id}` : ""}.`
      : `${goal.executor} goal ${goal.goal_id} registered as ${goal.state}.`;
    return createSuccessEnvelope(result, summary, { warnings });
  }
  if (args.operation === "sync_console") {
    const consoleState = await new PortfolioConsoleStateService(repo.root).update(args.console_patch ?? {});
    const observedAt = new Date().toISOString();
    const result = {
      ok: true, repo_id: args.repo_id, operation: args.operation, changed_count: 1, unchanged_count: 0,
      entries: [], recent_activity: [], observed_at: observedAt,
      ledger_path: ".chatgpt/portfolio-action-ledger.json", storage_path: ".chatgpt/operations-console-state.json",
      console_state: consoleState, warnings: [], next_action: "refresh_repo_portfolio_report_to_verify_console_state"
    };
    audit({ tool: "repo_portfolio_action_command", repo_id: args.repo_id, counts: { changed: 1, unchanged: 0 }, warnings: [] });
    return createSuccessEnvelope(result, "Operations Console preferences synchronized.");
  }
  const ledgerService = new PortfolioActionLedgerService(repo.root);
  let executionReceipts;
  let effectiveArgs = args;
  if (args.execution) {
    const action = args.actions[0]!;
    const goalCommand = goalService.fromExecution({ repo_id: args.repo_id, action_id: action.action_id, execution: args.execution });
    const existingGoal = await goalService.findIdempotent(goalCommand.idempotency_key);
    if (existingGoal?.hermes_transaction) {
      const observedAt = new Date().toISOString();
      const receipt = {
        ok: true, goal_id: existingGoal.goal_id, action_id: action.action_id, target_repo_id: existingGoal.repository_id,
        status: existingGoal.state === "accepted" ? "accepted" as const : "resumed" as const,
        transaction_id: existingGoal.hermes_transaction, board: existingGoal.hermes_board, task_id: existingGoal.hermes_task,
        transaction_path: "", satisfaction_gate: existingGoal.satisfaction_threshold,
        operator_status: "Existing durable execution resumed; no duplicate launch was created.", observed_at: observedAt,
        warnings: ["IDEMPOTENT_EXECUTION_RESUMED"], next_action: "inspect_repo_runner_status_with_capability_id_hermes_kanban_and_the_same_transaction"
      };
      const snapshot = await ledgerService.read();
      const result = { ok: true, repo_id: args.repo_id, operation: args.operation, changed_count: 0, unchanged_count: 1,
        entries: [], recent_activity: snapshot.activity.slice(0, 30), observed_at: observedAt,
        ledger_path: ".chatgpt/portfolio-action-ledger.json", storage_path: ".chatgpt/goal-records-v1.json",
        execution_receipts: [receipt], goal_records: [existingGoal], warnings: receipt.warnings, next_action: receipt.next_action };
      return createSuccessEnvelope(result, receipt.operator_status, { warnings: receipt.warnings });
    }
    if (args.execution.executor && args.execution.executor !== "hermes") {
      const blocked = await goalService.upsert({ ...goalCommand, state: "blocked", unmet_dimensions: ["Requested executor has no approved launch adapter on this action path."] });
      const result = { ok: false, repo_id: args.repo_id, operation: args.operation, changed_count: 0, unchanged_count: 1,
        entries: [], recent_activity: [], observed_at: blocked.updated_at, ledger_path: ".chatgpt/portfolio-action-ledger.json", storage_path: ".chatgpt/goal-records-v1.json",
        goal_records: [blocked], warnings: ["EXECUTOR_ADAPTER_UNAVAILABLE"], next_action: "register_direct_codex_or_choose_the_existing_hermes_route" };
      return createSuccessEnvelope(result, "Execution failed closed because the requested executor has no approved adapter.", { warnings: result.warnings });
    }
    const target = context.registry.get(args.execution.target_repo_id);
    const execution = await new PortfolioExecutionService().launch({
      repo_id: args.repo_id,
      action_id: action.action_id,
      target_repo_id: args.execution.target_repo_id,
      target_repo_root: target.root,
      execution: args.execution
    });
    const launchGoal = await goalService.recordLaunch(goalCommand, execution);
    executionReceipts = [execution];
    if (!execution.ok) {
      const snapshot = await ledgerService.read();
      const observedAt = new Date().toISOString();
      const blocked = {
        ok: false, repo_id: args.repo_id, operation: args.operation, changed_count: 0, unchanged_count: 1,
        entries: [], recent_activity: snapshot.activity.slice(0, 30), observed_at: observedAt,
        ledger_path: ".chatgpt/portfolio-action-ledger.json", storage_path: ".chatgpt/portfolio-action-ledger.json",
        execution_receipts: executionReceipts, goal_records: [launchGoal], warnings: execution.warnings, next_action: execution.next_action
      };
      audit({ tool: "repo_portfolio_action_command", repo_id: args.repo_id, counts: { changed: 0, unchanged: 1 }, warnings: execution.warnings });
      return createSuccessEnvelope(blocked, execution.operator_status, { warnings: execution.warnings });
    }
    effectiveArgs = {
      ...args,
      receipt_summary: `Hermes ${execution.status}: goal ${execution.goal_id}; transaction ${execution.transaction_id}; board ${execution.board}; task ${execution.task_id}.`
    };
  }
  const result = await ledgerService.execute(args.repo_id, effectiveArgs);
  const resultWithExecution = executionReceipts ? { ...result, execution_receipts: executionReceipts, goal_records: await goalService.read().then((goals) => goals.filter((goal) => goal.goal_id === executionReceipts![0]!.goal_id)), next_action: executionReceipts[0]!.next_action } : result;
  audit({ tool: "repo_portfolio_action_command", repo_id: args.repo_id, counts: { changed: result.changed_count, unchanged: result.unchanged_count }, warnings: result.warnings });
  return createSuccessEnvelope(resultWithExecution, executionReceipts ? executionReceipts[0]!.operator_status : `${result.changed_count} portfolio action(s) moved by ${args.operation}.`, { warnings: result.warnings });
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

export const repoProjectContextHandler: ToolHandler = async (input, context) => safeTool<RepoProjectContextInput>("repo_project_context", input, context, async (rawArgs) => {
  const args = RepoProjectContextInputSchema.parse(rawArgs);
  const repoId = readOnlyRepoId(args.repo_id);
  const repo = context.registry.get(repoId);
  const sandbox = new PathSandbox(repo.root);

  if (args.mode === "brief") {
    const result = await new ProjectBriefService(repo, sandbox).brief({
      include: args.include
    });
    audit({ tool: "repo_project_context", repo_id: repoId, counts: { docs: result.key_docs.length, scripts: result.scripts.length }, truncated: result.truncated, warnings: result.warnings });
    return createSuccessEnvelope(
      { ok: true as const, mode: args.mode, delegated_tool: "repo_project_brief" as const, result, warnings: result.warnings },
      `repo_project_context brief returned for ${repo.display_name}.`,
      { warnings: result.warnings }
    );
  }

  if (args.mode === "memory") {
    const result = await new ProjectMemoryService(repo, sandbox).dashboard({
      include_archived: args.include_archived
    });
    audit({ tool: "repo_project_context", repo_id: repoId, counts: { projects: result.project_count, roadmap: result.roadmap.length }, warnings: result.warnings });
    return createSuccessEnvelope(
      { ok: true as const, mode: args.mode, delegated_tool: "repo_project_memory" as const, result, warnings: result.warnings },
      `repo_project_context memory returned ${result.project_count} projects.`,
      { warnings: result.warnings }
    );
  }

  if (args.mode === "tasks") {
    const result = await new TaskInventoryService(repo.root, sandbox).inventory({
      include_globs: args.include_globs,
      exclude_globs: args.exclude_globs,
      labels: args.labels,
      max_results: args.max_results,
      cursor: args.cursor
    });
    audit({ tool: "repo_project_context", repo_id: repoId, counts: { tasks: result.returned_count }, truncated: result.truncated, warnings: result.warnings });
    return createSuccessEnvelope(
      { ok: true as const, mode: args.mode, delegated_tool: "repo_task_inventory" as const, result, warnings: result.warnings },
      `repo_project_context tasks returned ${result.returned_count} items.`,
      { warnings: result.warnings }
    );
  }

  if (args.mode === "decisions") {
    const result = await new DecisionLogService(repo.root, sandbox).decisionLog({
      include_sources: args.include_sources
    });
    audit({ tool: "repo_project_context", repo_id: repoId, counts: { decisions: result.decisions.length, conventions: result.conventions.length }, warnings: result.warnings });
    return createSuccessEnvelope(
      { ok: true as const, mode: args.mode, delegated_tool: "repo_decision_memory" as const, result, warnings: result.warnings },
      `repo_project_context decisions returned ${result.decisions.length} decisions and ${result.conventions.length} conventions.`,
      { warnings: result.warnings }
    );
  }

  if (args.mode === "plan") {
    if (!args.goal) {
      throw new Error("repo_project_context plan mode requires goal.");
    }
    const result = await new ChangePlanService(repo.root, sandbox).plan({
      goal: args.goal,
      include_globs: args.include_globs,
      max_files_to_inspect: args.max_files_to_inspect,
      planning_depth: args.planning_depth
    });
    audit({ tool: "repo_project_context", repo_id: repoId, counts: { relevant_files: result.relevant_files.length, steps: result.proposed_steps.length }, warnings: result.warnings });
    return createSuccessEnvelope(
      { ok: true as const, mode: args.mode, delegated_tool: "repo_change_plan" as const, result, warnings: result.warnings },
      `repo_project_context plan returned ${result.proposed_steps.length} steps.`,
      { warnings: result.warnings }
    );
  }

  const result = await new NextActionService(repo, sandbox).recommend({
    mode: args.next_action_mode,
    horizon: args.horizon
  });
  audit({ tool: "repo_project_context", repo_id: repoId, counts: { actions: result.suggested_actions.length, blockers: result.blockers.length }, warnings: result.warnings });
  return createSuccessEnvelope(
    { ok: true as const, mode: args.mode, delegated_tool: "repo_next_action" as const, result, warnings: result.warnings },
    result.recommendation,
    { warnings: result.warnings }
  );
});

export const planReviewHandler: ToolHandler = async (input) => {
  const args = z.object({ prompt: z.string().min(1) }).parse(input);
  const result = new ReviewPlanner().plan(args.prompt);
  return createSuccessEnvelope(result, `Recommended next tool: ${result.recommended_next_tools[0]}.`);
};

export const prepareCodexTaskHandler: ToolHandler = async (input, context) => safeTool<CodexTaskInput>("repo_prepare_codex_task", input, context, async (args) => {
  const { queueRepo, warnings } = codexQueueForTarget(context, args.repo_id);
  const prepared = new CodexTaskService(queueRepo.root, new PathSandbox(queueRepo.root), new WritePolicy(queueRepo.writes)).prepare(args);
  const result = withCodexQueueMetadata(prepared, queueRepo, warnings);
  audit({ tool: "repo_prepare_codex_task", repo_id: args.repo_id, paths: [result.prompt_path, result.result_path], warnings: result.warnings });
  return createSuccessEnvelope(result, `Prepared Codex task ${result.run_id} for ${args.repo_id}.`);
});

export const writeCodexTaskHandler: ToolHandler = async (input, context) => safeTool<CodexTaskWriteInput>("repo_write_codex_task", input, context, async (args) => {
  const { queueRepo, warnings: queueWarnings } = codexQueueForTarget(context, args.repo_id);
  const headShaBefore = await readHeadSha(queueRepo.root);
  const result = withCodexQueueMetadata(
    await new CodexTaskService(queueRepo.root, new PathSandbox(queueRepo.root), new WritePolicy(queueRepo.writes)).write(args),
    queueRepo,
    queueWarnings
  );
  if (!result.dry_run && result.written_paths.length > 0) {
    const headShaAfter = await readHeadSha(queueRepo.root);
    const receipt = await new OperationReceiptService(queueRepo.root).writeLastWrite({
      tool: "repo_write_codex_task",
      repo_id: queueRepo.repo_id,
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
      summary: `Queued Codex task ${result.run_id} for target repo ${args.repo_id}.`
    });
    const resultWithReceipt = {
      ...result,
      warnings: [...result.warnings, ...receipt.warnings],
      ...(receipt.operation_receipt ? { operation_receipt: receipt.operation_receipt } : {})
    };
    audit({ tool: "repo_write_codex_task", repo_id: args.repo_id, paths: resultWithReceipt.written_paths, warnings: resultWithReceipt.warnings });
    return createSuccessEnvelope(
      resultWithReceipt,
      `Queued Codex task ${resultWithReceipt.run_id} for ${args.repo_id} in ${queueRepo.repo_id}.`,
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
  const { queueRepo, warnings: queueWarnings } = codexQueueForTarget(context, args.repo_id);
  const headShaBefore = await readHeadSha(queueRepo.root);
  const result = withCodexQueueMetadata(
    await new CodexTaskService(queueRepo.root, new PathSandbox(queueRepo.root), new WritePolicy(queueRepo.writes)).writeBatch(args),
    queueRepo,
    queueWarnings
  );
  if (!result.dry_run && result.written_paths.length > 0) {
    const headShaAfter = await readHeadSha(queueRepo.root);
    const receipt = await new OperationReceiptService(queueRepo.root).writeLastWrite({
      tool: "repo_write_codex_tasks_batch",
      repo_id: queueRepo.repo_id,
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
      summary: `Queued ${result.created_run_ids.length} Codex task seeds for target repo ${args.repo_id}.`
    });
    const resultWithReceipt = {
      ...result,
      warnings: [...result.warnings, ...receipt.warnings],
      ...(receipt.operation_receipt ? { operation_receipt: receipt.operation_receipt } : {})
    };
    audit({ tool: "repo_write_codex_tasks_batch", repo_id: args.repo_id, paths: resultWithReceipt.written_paths, warnings: resultWithReceipt.warnings });
    return createSuccessEnvelope(
      resultWithReceipt,
      `Queued ${resultWithReceipt.created_run_ids.length} Codex task seeds for ${args.repo_id} in ${queueRepo.repo_id}: ${resultWithReceipt.created_run_ids.join(", ")}.`,
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
  const { targetRepo, queueRepo, warnings: queueWarnings } = codexQueueForTarget(context, args.repo_id);
  const reviewed = await new CodexResultService(
    new PathSandbox(queueRepo.root),
    new GitReviewService(targetRepo.root, new OperationsPolicy(targetRepo.operations))
  ).review(args);
  const result = withCodexQueueMetadata(reviewed, queueRepo, queueWarnings);
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

export const codexAppserverTurnHandler: ToolHandler = async (input, context) => safeTool<CodexAppserverTurnInput>("repo_codex_appserver_turn", input, context, async (args) => {
  const repo = context.registry.get(args.repo_id);
  const result = await new CodexAppserverTurnService(repo.root).turn(args);
  audit({
    tool: "repo_codex_appserver_turn",
    repo_id: args.repo_id,
    counts: {
      json_rpc_messages: result.json_rpc_messages.length
    },
    warnings: result.warnings
  });
  const summary = [
    `Codex app-server turn ${result.status}.`,
    `proof_boundary=${result.proof_boundary}`,
    `bootstrap_used=${result.bootstrap_used ? "yes" : "no"}`,
    `direct_send=${result.direct_send ? "yes" : "no"}`,
    `next=${result.next_proof_step}`
  ].join(" ");
  return createSuccessEnvelope(result, summary, { warnings: result.warnings });
});

export const codexRunAndWaitHandler: ToolHandler = async (input, context) => safeTool<CodexRunAndWaitInput>("codex_run_and_wait", input, context, async (args) => {
  const { queueRepo, warnings: queueWarnings } = codexQueueForTarget(context, args.repo_id);
  const result = withCodexQueueMetadata(await new CodexRunService(queueRepo.root).runAndWait(args), queueRepo, queueWarnings);
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

export const hermesIntakeHandler: ToolHandler = async (input, context) => safeTool<HermesIntakeInput>("repo_hermes_intake", input, context, async (args) => {
  // repo_id identifies the project receiving the work, but Hermes intake is
  // bridge-owned control-plane state. Always write and submit from the Shared
  // Agent Bridge root after validating that the target repository is approved.
  const targetRepo = context.registry.get(args.repo_id);
  const bridgeRepo = context.registry.get("shared-agent-bridge");
  const result = await new HermesIntakeService(bridgeRepo.root, undefined, targetRepo.root).submit(args);
  audit({
    tool: "repo_hermes_intake",
    repo_id: args.repo_id,
    paths: [result.manifest_path, result.intake_path, result.result_path],
    counts: { spawned: result.spawned ? 1 : 0 },
    warnings: result.warnings
  });
  const summary = result.submitted
    ? `Hermes intake ${result.status}: board=${result.board}; result_read=${result.result_read ? "yes" : "no"}; result_path=${result.result_path}.`
    : `Hermes intake packet written: ${result.manifest_path}.`;
  return createSuccessEnvelope(result, summary, { warnings: result.warnings });
});

export const hermesInterveneHandler: ToolHandler = async (input, context) => safeTool<HermesInterventionInput>("repo_hermes_intervene", input, context, async (args) => {
  context.registry.get(args.repo_id);
  const result = await new HermesSupervisionService().intervene(args);
  audit({
    tool: "repo_hermes_intervene",
    repo_id: args.repo_id,
    paths: [result.checkpoint_path, result.receipt_path].filter(Boolean),
    counts: { appended: result.status === "checkpoint_appended" ? 1 : 0 },
    warnings: result.warnings
  });
  const summary = result.status === "checkpoint_appended"
    ? `Hermes checkpoint ${result.intervention_id} appended to ${result.transaction_id}.`
    : `Hermes intervention rejected for ${result.transaction_id}.`;
  return createSuccessEnvelope(result, summary, { warnings: result.warnings });
});

export const hermesCancelHandler: ToolHandler = async (input, context) => safeTool<HermesCancelInput>("repo_hermes_cancel", input, context, async (args) => {
  context.registry.get(args.repo_id);
  const result = await new HermesCancelService().execute(args);
  audit({ tool: "repo_hermes_cancel", repo_id: args.repo_id, counts: { stopped_processes: result.stopped_process_count }, warnings: result.warnings });
  return createSuccessEnvelope(result, result.status === "cancelled" ? `Hermes transaction ${result.transaction_id} cancelled with ${result.stopped_process_count} verified process stop(s).` : `Hermes cancellation ${result.status}.`, { warnings: result.warnings });
});

export const hermesKanbanCommandHandler: ToolHandler = async (input, context) => safeTool<HermesKanbanCommandInput>("repo_hermes_kanban_command", input, context, async (args) => {
  context.registry.get(args.repo_id);
  const result = await new HermesKanbanCommandService().execute(args);
  audit({
    tool: "repo_hermes_kanban_command",
    repo_id: args.repo_id,
    counts: { executed: result.status === "executed" ? 1 : 0, dry_run: result.status === "dry_run" ? 1 : 0 },
    warnings: result.warnings
  });
  const summary = result.ok
    ? `Hermes Kanban ${result.operation} ${result.status}: ${result.task_id || result.board}.`
    : `Hermes Kanban ${result.operation} rejected before mutation.`;
  return createSuccessEnvelope(result, summary, { warnings: result.warnings });
});

function codexQueueForTarget(context: RuntimeContext, targetRepoId: string): {
  targetRepo: RegisteredRepo;
  queueRepo: RegisteredRepo;
  warnings: string[];
} {
  const targetRepo = context.registry.get(targetRepoId);
  try {
    const queueRepo = context.registry.get(CENTRAL_CODEX_QUEUE_REPO_ID);
    if (queueRepo.repo_id === targetRepo.repo_id) {
      return { targetRepo, queueRepo, warnings: [] };
    }
    return {
      targetRepo,
      queueRepo,
      warnings: [
        `CODEX_CENTRAL_QUEUE: task/result files live under ${queueRepo.repo_id}; implementation and git review target ${targetRepo.repo_id}.`
      ]
    };
  } catch {
    return {
      targetRepo,
      queueRepo: targetRepo,
      warnings: [
        `CODEX_CENTRAL_QUEUE_UNAVAILABLE: ${CENTRAL_CODEX_QUEUE_REPO_ID} is not registered; using repo-local Codex queue for ${targetRepo.repo_id}.`
      ]
    };
  }
}

async function queueGoalReviewCodexFollowup(
  context: RuntimeContext,
  goal: GoalRecord,
  review: GoalReviewDecision,
  reason?: string
): Promise<CodexFollowupReceipt> {
  const { queueRepo, warnings: queueWarnings } = codexQueueForTarget(context, goal.repository_id);
  const service = new CodexTaskService(queueRepo.root, new PathSandbox(queueRepo.root), new WritePolicy(queueRepo.writes));
  const headShaBefore = await readHeadSha(queueRepo.root);
  const decisionLabel = review.decision === "yes" ? "continue" : "replace";
  const title = `${goal.project_name || goal.project_id} field review ${decisionLabel}`;
  const objective = review.decision === "yes"
    ? [
        `Continue the direct Codex goal from this Field Console approval: ${goal.objective}`,
        "",
        "Operator instruction:",
        review.instruction,
        "",
        `Move the work toward the ${goal.satisfaction_threshold}% acceptance gate. Keep the slice bounded to the allowed paths and write RESULT.md with exact proof.`
      ].join("\n")
    : [
        `Do not continue the rejected recommendation as-is for this direct Codex goal: ${goal.objective}`,
        "",
        "Operator instruction:",
        review.instruction,
        "",
        "Produce a smaller or more actionable replacement work slice, then implement only that bounded replacement if it is safe within the allowed paths. Write RESULT.md with what changed, what was deferred, and exact proof."
      ].join("\n");
  const contextSummary = [
    `Field Console review decision: ${review.decision.toUpperCase()}.`,
    `Goal id: ${goal.goal_id}.`,
    `Current state: ${goal.state}; current score: ${goal.satisfaction_score}/${goal.satisfaction_threshold}.`,
    goal.unmet_dimensions.length > 0 ? `Unmet dimensions: ${goal.unmet_dimensions.join("; ")}` : "",
    goal.intervention ? `Previous intervention: ${goal.intervention}` : ""
  ].filter(Boolean).join("\n");
  const inspectFirst = uniqueStrings([
    "CURRENT_STATE.md",
    "docs/ONBOARDING.md",
    ...goal.evidence,
    ...goal.artifacts,
    ...goal.changed_files,
    ...goal.execution_scope
  ]).slice(0, 40);
  const allowedPaths = uniqueStrings(goal.execution_scope.length > 0 ? goal.execution_scope : goal.changed_files).slice(0, 40);
  const result = withCodexQueueMetadata(
    await service.write({
      repo_id: goal.repository_id,
      title,
      objective,
      context_summary: contextSummary,
      inspect_first: inspectFirst,
      allowed_paths: allowedPaths,
      forbidden_paths: [],
      acceptance_criteria: [
        `Respect the Field Console ${review.decision.toUpperCase()} decision.`,
        goal.proof_boundary,
        `Do not claim completion unless the result can satisfy ${goal.satisfaction_threshold}% acceptance or clearly reports the remaining blocker.`
      ],
      verification_commands: [],
      goal_lane: {
        enabled: true,
        goal_id: goal.goal_id,
        goal_title: goal.project_name || goal.project_id,
        mode: "goal",
        origin: "repo_write_codex_task",
        status_policy: "compact"
      },
      reason: reason ?? `Field Console ${review.decision.toUpperCase()} review follow-up for ${goal.goal_id}.`
    }),
    queueRepo,
    queueWarnings
  );
  if (!result.dry_run && result.written_paths.length > 0) {
    const headShaAfter = await readHeadSha(queueRepo.root);
    const receipt = await new OperationReceiptService(queueRepo.root).writeLastWrite({
      tool: "repo_write_codex_task",
      repo_id: queueRepo.repo_id,
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
      summary: `Queued Field Console ${review.decision.toUpperCase()} follow-up ${result.run_id} for target repo ${goal.repository_id}.`
    });
    result.warnings.push(...receipt.warnings);
  }
  return {
    queued: result.queued_status === "queued",
    run_id: result.run_id,
    queue_repo_id: result.queue_repo_id,
    target_repo_id: goal.repository_id,
    prompt_path: result.prompt_path,
    result_path: result.result_path,
    manifest_path: result.manifest_path,
    written_paths: result.written_paths,
    warnings: result.warnings
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function effectiveRunnerStatusForRepo(
  context: RuntimeContext,
  targetRepo: Pick<RegisteredRepo, "repo_id" | "root">,
  input: AgentRunnerStatusInput
): Promise<AgentRunnerStatusResult> {
  const { queueRepo } = codexQueueForTarget(context, targetRepo.repo_id);
  const statusInput = {
    ...input,
    repo_id: queueRepo.repo_id
  };
  const status = await new AgentRunnerStatusService(queueRepo.root).status(statusInput);
  if (queueRepo.repo_id === targetRepo.repo_id) {
    return status;
  }
  const coverage = centralQueueCoverage(targetRepo, queueRepo, status);
  return {
    ...status,
    repo_id: targetRepo.repo_id,
    central_queue: coverage,
    plain_text: [
      `Target repo: ${targetRepo.repo_id}`,
      `Codex queue: ${coverage.status}; queue_repo_id=${coverage.queue_repo_id}; project_runner_required=${coverage.project_runner_required ? "yes" : "no"}`,
      `Runner proof: ${coverage.proof}`,
      coverage.guidance,
      "",
      status.plain_text
    ].join("\n")
  };
}

function centralQueueCoverage(
  targetRepo: Pick<RegisteredRepo, "repo_id" | "root">,
  queueRepo: RegisteredRepo,
  status: AgentRunnerStatusResult
) {
  return {
    enabled: true,
    target_repo_id: targetRepo.repo_id,
    queue_repo_id: queueRepo.repo_id,
    project_runner_required: false,
    status: "covered_by_central_runner",
    proof: `repo_runner_status on ${queueRepo.repo_id}: runner=${status.runner}; worker=${status.worker}; runtime_assessment=${status.runtime_assessment}; pending=${status.pending_count}; active=${status.active_count}; stale=${status.stale_lock_count}`,
    guidance: `Use repo_write_codex_task with repo_id ${targetRepo.repo_id}; observe pickup through repo_runner_status on ${queueRepo.repo_id}; use repo_codex_review with repo_id ${targetRepo.repo_id} after RESULT.md exists. Do not infer project runner offline from a missing per-project heartbeat.`
  };
}

function withCodexQueueMetadata<T extends { warnings: string[] }>(
  result: T,
  queueRepo: RegisteredRepo,
  warnings: string[]
): T & { queue_repo_id: string } {
  return {
    ...result,
    queue_repo_id: queueRepo.repo_id,
    warnings: [...result.warnings, ...warnings]
  };
}

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
  options: { detail: "summary" | "full"; capabilityId?: string; portalId?: string; hermesBoard?: string; hermesTransaction?: string; hermesCursor?: string; repoRoot?: string; runnerStatusSurface?: boolean }
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
    },
    ws_bridge_room: compactWsBridgeRoom(summary.ws_bridge_room)
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

function compactWsBridgeRoom(wsBridgeRoom: CapabilitySummaryResult["ws_bridge_room"]) {
  return {
    state: wsBridgeRoom.state,
    current_route: wsBridgeRoom.current_route,
    room_id: wsBridgeRoom.room_id,
    event_log_path: wsBridgeRoom.event_log_path,
    event_count: wsBridgeRoom.event_count,
    last_event_at: wsBridgeRoom.last_event_at,
    proof_boundary: wsBridgeRoom.proof_boundary,
    evidence: wsBridgeRoom.evidence,
    last_validated_at: wsBridgeRoom.last_validated_at,
    ttl_seconds: wsBridgeRoom.ttl_seconds,
    confidence: wsBridgeRoom.confidence,
    validation_source: wsBridgeRoom.validation_source,
    warnings: wsBridgeRoom.warnings
  };
}

async function focusedCapabilitySummary(
  summary: CapabilitySummaryResult,
  capabilityId: string,
  options: { detail: "summary" | "full"; portalId?: string; hermesBoard?: string; hermesTransaction?: string; hermesCursor?: string; repoRoot?: string }
) {
  const capability = summary.capability_toc.capabilities.find((entry) => entry.capability_id === capabilityId);
  const virtualCapability = capabilityId === "ws_bridge_room"
    ? {
        capability_id: "ws_bridge_room",
        status: summary.ws_bridge_room.state,
        summary: "Read-only WebSocket Bridge Room V0 status and recent events through the existing capability_summary hub.",
        existing_tool_or_hub_route: "repo_runner_status.capability_summary.ws_bridge_room; repo_list_roots.capability_summary.ws_bridge_room",
        safe_operations: ["observe_room_status", "read_recent_room_events"],
        blocked_operations: ["send_room_event", "mutate_route_proof", "update_binding", "write_receipt"],
        suggested_next_action: "use the room events as live coordination hints only; verify route proof through binding receipts"
      }
    : capabilityId === "hermes_kanban"
      ? {
          capability_id: "hermes_kanban",
          status: "read_only_focused_hub",
          summary: "Read-only Hermes Kanban, off-thread transaction status, receipt gate, and compact live-tail evidence through the existing capability_summary hub.",
          existing_tool_or_hub_route: "repo_runner_status with capability_id hermes_kanban; repo_list_roots with capability_id hermes_kanban",
          safe_operations: ["observe_boards", "read_task_status", "read_transaction_live_tail", "inspect_receipt_gate", "report_current_status"],
          blocked_operations: ["create_task", "claim_task", "complete_task", "mutate_repo", "stage_commit_push", "delete_artifacts", "restart_services", "acceptance_override"],
          suggested_next_action: "use hermes_transaction for one supervised transaction; use repo_hermes_intervene only for an explicitly approved bounded checkpoint correction"
        }
    : undefined;
  const focusedCapability = capability ?? virtualCapability;
  const hermesKanban = capabilityId === "hermes_kanban"
    ? await new HermesKanbanStatusService().status({
        board: options.hermesBoard,
        transaction: options.hermesTransaction,
        cursor: options.hermesCursor,
        max_supervision_events: options.detail === "full" ? 30 : 12
      })
    : undefined;
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
      found: Boolean(focusedCapability),
      full_detail_hint: "This focused response expands one named capability. Use detail: \"full\" without capability_id for full diagnostics."
    },
    bridge_compass: summary.bridge_compass,
    ...(capabilityId === "concierge_style_routing" ? { concierge_preflight: summary.concierge_preflight } : {}),
    ...(capabilityId === "ws_bridge_room" ? { ws_bridge_room: summary.ws_bridge_room } : {}),
    ...(hermesKanban ? { hermes_kanban: hermesKanban } : {}),
    capability_toc: {
      state: focusedCapability ? summary.capability_toc.state : "blocked",
      source_path: summary.capability_toc.source_path,
      generated_at: summary.capability_toc.generated_at,
      capability_count: summary.capability_toc.capability_count,
      returned_count: focusedCapability ? 1 : 0,
      capabilities: focusedCapability ? [focusedCapability] : [],
      ...(focusedCapability ? {} : { blocker: `Capability id not found: ${capabilityId}` })
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
