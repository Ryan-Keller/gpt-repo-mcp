import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { AgentRunnerStatusInputSchema, AgentRunnerStatusReferenceResultSchema, AgentRunnerStatusResultSchema } from "../src/contracts/agent-runner.contract.js";
import { BridgeConciergeInputSchema, BridgeConciergeResultSchema } from "../src/contracts/bridge-concierge.contract.js";
import {
  WriteChangesInputSchema,
  WriteChangesResultSchema,
  WriteFileInputSchema,
  WriteFileResultSchema
} from "../src/contracts/write.contract.js";
import {
  GitCommitInputSchema,
  GitCommitResultSchema,
  GitRecoverInputSchema,
  GitRecoverResultSchema,
  GitRestorePathsInputSchema,
  GitRestorePathsResultSchema,
  GitStageCommitInputSchema,
  GitStageCommitResultSchema,
  GitStageInputSchema,
  GitStageResultSchema,
  GitUnstageInputSchema,
  GitUnstageResultSchema
} from "../src/contracts/git-operations.contract.js";
import { CleanupPathsInputSchema, CleanupPathsResultSchema } from "../src/contracts/cleanup.contract.js";
import { CodexAppserverTurnInputSchema, CodexAppserverTurnResultSchema } from "../src/contracts/codex-appserver.contract.js";
import { CodexReviewInputSchema, CodexReviewResultSchema, CodexRunAndWaitInputSchema, CodexRunAndWaitResultSchema, CodexTaskBatchWriteInputSchema, CodexTaskBatchWriteResultSchema, CodexTaskWriteInputSchema, CodexTaskWriteResultSchema } from "../src/contracts/codex-task.contract.js";
import { DecisionLogInputSchema, DecisionLogResultSchema } from "../src/contracts/decision.contract.js";
import { GitReviewResultSchema } from "../src/contracts/git-review.contract.js";
import { HandoffInputSchema, HandoffResultSchema } from "../src/contracts/handoff.contract.js";
import { HermesIntakeInputSchema, HermesIntakeResultSchema } from "../src/contracts/hermes-intake.contract.js";
import { HermesInterventionInputSchema, HermesInterventionResultSchema, HermesKanbanCommandInputSchema, HermesKanbanCommandResultSchema } from "../src/contracts/hermes-supervision.contract.js";
import { LabExecInputSchema, LabExecResultSchema } from "../src/contracts/lab-exec.contract.js";
import { TownPortalReturnInputSchema, TownPortalReturnResultSchema } from "../src/contracts/town-portal.contract.js";
import { LastWriteInputSchema, LastWriteResultSchema } from "../src/contracts/operation-receipt.contract.js";
import { RepoProjectContextInputSchema, RepoProjectContextResultSchema } from "../src/contracts/project-context.contract.js";
import { ProjectBriefInputSchema } from "../src/contracts/project.contract.js";
import { RepoReaderConfigSchema } from "../src/config/schema.js";
import { RepoReadInputSchema, RepoReadResultSchema } from "../src/contracts/read-hub.contract.js";
import { TaskInventoryInputSchema } from "../src/contracts/task.contract.js";
import { boundedPacketWriteAnnotations, readOnlyAnnotations, writeAnnotations } from "../src/tools/annotations.js";
import { compactToolCatalog, fullToolCatalog, getToolCatalogForProfile, toolCatalog } from "../src/tools/catalog.js";
import { toolContracts } from "../src/tools/contracts.js";
import { MUTATING_TOOL_NAMES, isMutatingToolName } from "../src/tools/mutating-tools.js";
import { createAuditEvent } from "../src/runtime/telemetry.js";

function expectFieldDescriptions(fields: Array<[string, { description?: string }]>): void {
  for (const [field, schema] of fields) {
    expect(schema.description, `${field} should have a field description`).toBeTypeOf("string");
    expect(schema.description?.length, `${field} should have a non-empty field description`).toBeGreaterThan(10);
  }
}

function schemaDescription(schema: unknown): string | undefined {
  return (schema as { description?: string }).description;
}

const chatGptDirectToolNames = new Set([
  "repo_bridge_concierge",
  "repo_hermes_intake",
  "repo_hermes_cancel",
  "repo_hermes_kanban_command",
  "repo_hermes_watch",
  "repo_portfolio_report",
  "repo_portfolio_action_command"
]);

const connectorHostileSchemaKeywords = new Set([
  "anyOf",
  "oneOf",
  "propertyNames",
  "default",
  "const"
]);

function findConnectorHostileSchemaKeywords(value: unknown, path = "$", hits: string[] = []): string[] {
  if (!value || typeof value !== "object") {
    return hits;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => findConnectorHostileSchemaKeywords(item, `${path}[${index}]`, hits));
    return hits;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (connectorHostileSchemaKeywords.has(key)) {
      hits.push(childPath);
    }
    findConnectorHostileSchemaKeywords(child, childPath, hits);
  }

  return hits;
}

describe("tool catalog contracts", () => {
  test("all tools have required metadata and appropriate annotations", () => {
    expect(toolCatalog.map((tool) => tool.name)).toEqual([
      "repo_list_roots",
      "repo_bridge_concierge",
      "repo_hermes_intake",
      "repo_hermes_intervene",
      "repo_hermes_cancel",
      "repo_hermes_kanban_command",
      "repo_hermes_watch",
      "repo_portfolio_report",
      "repo_portfolio_action_command",
      "agent_runner_status",
      "repo_runner_status",
      "repo_run_live_tail",
      "repo_last_write",
      "repo_read",
      "repo_tree",
      "repo_search",
      "repo_fetch_file",
      "repo_read_many",
      "repo_git_status",
      "repo_git_diff",
      "repo_git_review",
      "repo_git_stage",
      "repo_git_unstage",
      "repo_git_restore_paths",
      "repo_git_commit",
      "repo_write_stage",
      "repo_write_unstage",
      "repo_write_commit",
      "repo_write_stage_commit",
      "repo_write_recover",
      "repo_cleanup_paths",
      "repo_project_context",
      "repo_project_brief",
      "repo_project_memory",
      "repo_task_inventory",
      "repo_decision_memory",
      "repo_change_plan",
      "repo_next_action",
      "repo_write_codex_task",
      "repo_write_codex_tasks_batch",
      "repo_codex_appserver_turn",
      "repo_codex_review",
      "codex_run_and_wait",
      "repo_lab_exec",
      "repo_town_portal_return",
      "repo_write_file",
      "repo_write_changes",
      "repo_write_handoff"
    ]);

    for (const tool of toolCatalog) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.startsWith("Use this when")).toBe(true);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      if (isMutatingToolName(tool.name)) {
        expect(tool.annotations).toEqual(["repo_hermes_intake", "repo_hermes_intervene", "repo_hermes_cancel", "repo_portfolio_action_command"].includes(tool.name) ? boundedPacketWriteAnnotations : writeAnnotations);
      } else {
        expect(tool.annotations).toEqual(readOnlyAnnotations);
      }
      expect(tool.handler).toBeTypeOf("function");
    }
  });

  test("compact profile is the default ChatGPT tool surface", () => {
    expect(toolCatalog).toBe(fullToolCatalog);
    expect(getToolCatalogForProfile("full")).toBe(fullToolCatalog);
    expect(getToolCatalogForProfile("compact")).toBe(compactToolCatalog);
    expect(compactToolCatalog.map((tool) => tool.name)).toEqual([
      "repo_list_roots",
      "repo_bridge_concierge",
      "repo_hermes_intake",
      "repo_hermes_intervene",
      "repo_hermes_cancel",
      "repo_hermes_kanban_command",
      "repo_hermes_watch",
      "repo_portfolio_report",
      "repo_portfolio_action_command",
      "repo_runner_status",
      "repo_last_write",
      "repo_read",
      "repo_git_status",
      "repo_git_diff",
      "repo_git_review",
      "repo_write_stage_commit",
      "repo_write_recover",
      "repo_project_context",
      "repo_write_codex_task",
      "repo_codex_review",
      "repo_write_changes",
      "repo_write_handoff"
    ]);
    expect(compactToolCatalog).toHaveLength(22);
    expect(fullToolCatalog).toHaveLength(48);
    expect(compactToolCatalog.map((tool) => tool.name)).not.toContain("agent_runner_status");
    expect(compactToolCatalog.map((tool) => tool.name)).not.toContain("repo_run_live_tail");
    expect(compactToolCatalog.map((tool) => tool.name)).not.toContain("repo_lab_exec");
    expect(compactToolCatalog.map((tool) => tool.name)).not.toContain("repo_write_file");
    expect(compactToolCatalog.map((tool) => tool.name)).not.toContain("repo_tree");
    expect(compactToolCatalog.map((tool) => tool.name)).not.toContain("repo_project_brief");
  });

  test("mutating tools use central contracts and annotations", () => {
    expect(MUTATING_TOOL_NAMES).toEqual([
      "repo_write_file",
      "repo_write_changes",
      "repo_write_handoff",
      "repo_write_codex_task",
      "repo_write_codex_tasks_batch",
      "repo_codex_appserver_turn",
      "codex_run_and_wait",
      "repo_lab_exec",
      "repo_hermes_intake",
      "repo_hermes_intervene",
      "repo_hermes_cancel",
      "repo_hermes_kanban_command",
      "repo_portfolio_action_command",
      "repo_town_portal_return",
      "repo_git_stage",
      "repo_git_unstage",
      "repo_git_restore_paths",
      "repo_git_commit",
      "repo_write_stage",
      "repo_write_unstage",
      "repo_write_commit",
      "repo_write_stage_commit",
      "repo_write_recover",
      "repo_cleanup_paths"
    ]);
    const writeFile = toolCatalog.find((tool) => tool.name === "repo_write_file");
    const repoRunnerStatus = toolCatalog.find((tool) => tool.name === "repo_runner_status");
    const bridgeConcierge = toolCatalog.find((tool) => tool.name === "repo_bridge_concierge");
    const writeCodexTask = toolCatalog.find((tool) => tool.name === "repo_write_codex_task");
    const writeCodexTasksBatch = toolCatalog.find((tool) => tool.name === "repo_write_codex_tasks_batch");
    const codexAppserverTurn = toolCatalog.find((tool) => tool.name === "repo_codex_appserver_turn");
    const codexReview = toolCatalog.find((tool) => tool.name === "repo_codex_review");
    const codexRunAndWait = toolCatalog.find((tool) => tool.name === "codex_run_and_wait");
    const labExec = toolCatalog.find((tool) => tool.name === "repo_lab_exec");
    const hermesIntake = toolCatalog.find((tool) => tool.name === "repo_hermes_intake");
    const hermesIntervene = toolCatalog.find((tool) => tool.name === "repo_hermes_intervene");
    const hermesKanbanCommand = toolCatalog.find((tool) => tool.name === "repo_hermes_kanban_command");
    const townPortalReturn = toolCatalog.find((tool) => tool.name === "repo_town_portal_return");
    const writeChanges = toolCatalog.find((tool) => tool.name === "repo_write_changes");
    const writeHandoff = toolCatalog.find((tool) => tool.name === "repo_write_handoff");
    const stageCommit = toolCatalog.find((tool) => tool.name === "repo_write_stage_commit");
    const recover = toolCatalog.find((tool) => tool.name === "repo_write_recover");
    const lastWrite = toolCatalog.find((tool) => tool.name === "repo_last_write");
    const repoRead = toolCatalog.find((tool) => tool.name === "repo_read");
    const repoProjectContext = toolCatalog.find((tool) => tool.name === "repo_project_context");
    const decisionMemory = toolCatalog.find((tool) => tool.name === "repo_decision_memory");
    const projectMemory = toolCatalog.find((tool) => tool.name === "repo_project_memory");

    expect(repoRunnerStatus).toBeDefined();
    expect(repoRunnerStatus?.inputSchema).toBe(AgentRunnerStatusInputSchema);
    expect(repoRunnerStatus?.outputSchema).toBe(AgentRunnerStatusReferenceResultSchema);
    expect(AgentRunnerStatusResultSchema.shape.poll_history).toBeDefined();
    expect(repoRunnerStatus?.annotations).toEqual(readOnlyAnnotations);
    expect(bridgeConcierge).toBeDefined();
    expect(bridgeConcierge?.inputSchema).toBe(BridgeConciergeInputSchema);
    expect(bridgeConcierge?.outputSchema).toBe(BridgeConciergeResultSchema);
    expect(bridgeConcierge?.annotations).toEqual(readOnlyAnnotations);
    expect(writeCodexTask).toBeDefined();
    expect(writeCodexTask?.inputSchema).toBe(CodexTaskWriteInputSchema);
    expect(writeCodexTask?.outputSchema).toBe(CodexTaskWriteResultSchema);
    expect(writeCodexTask?.annotations).toEqual(writeAnnotations);
    expect(writeCodexTasksBatch).toBeDefined();
    expect(writeCodexTasksBatch?.inputSchema).toBe(CodexTaskBatchWriteInputSchema);
    expect(writeCodexTasksBatch?.outputSchema).toBe(CodexTaskBatchWriteResultSchema);
    expect(writeCodexTasksBatch?.annotations).toEqual(writeAnnotations);
    expect(codexAppserverTurn).toBeDefined();
    expect(codexAppserverTurn?.inputSchema).toBe(CodexAppserverTurnInputSchema);
    expect(codexAppserverTurn?.outputSchema).toBe(CodexAppserverTurnResultSchema);
    expect(codexAppserverTurn?.annotations).toEqual(writeAnnotations);
    expect(codexReview).toBeDefined();
    expect(codexReview?.inputSchema).toBe(CodexReviewInputSchema);
    expect(codexReview?.outputSchema).toBe(CodexReviewResultSchema);
    expect(codexReview?.annotations).toEqual(readOnlyAnnotations);
    expect(codexRunAndWait).toBeDefined();
    expect(codexRunAndWait?.inputSchema).toBe(CodexRunAndWaitInputSchema);
    expect(codexRunAndWait?.outputSchema).toBe(CodexRunAndWaitResultSchema);
    expect(codexRunAndWait?.annotations).toEqual(writeAnnotations);
    expect(labExec).toBeDefined();
    expect(labExec?.inputSchema).toBe(LabExecInputSchema);
    expect(labExec?.outputSchema).toBe(LabExecResultSchema);
    expect(labExec?.annotations).toEqual(writeAnnotations);
    expect(hermesIntake).toBeDefined();
    expect(hermesIntake?.inputSchema).toBe(HermesIntakeInputSchema);
    expect(hermesIntake?.outputSchema).toBe(HermesIntakeResultSchema);
    expect(hermesIntake?.annotations).toEqual(boundedPacketWriteAnnotations);
    expect(hermesIntervene).toBeDefined();
    expect(hermesIntervene?.inputSchema).toBe(HermesInterventionInputSchema);
    expect(hermesIntervene?.outputSchema).toBe(HermesInterventionResultSchema);
    expect(hermesIntervene?.annotations).toEqual(boundedPacketWriteAnnotations);
    expect(hermesKanbanCommand).toBeDefined();
    expect(hermesKanbanCommand?.inputSchema).toBe(HermesKanbanCommandInputSchema);
    expect(hermesKanbanCommand?.outputSchema).toBe(HermesKanbanCommandResultSchema);
    expect(hermesKanbanCommand?.annotations).toEqual(writeAnnotations);
    expect(townPortalReturn).toBeDefined();
    expect(townPortalReturn?.inputSchema).toBe(TownPortalReturnInputSchema);
    expect(townPortalReturn?.outputSchema).toBe(TownPortalReturnResultSchema);
    expect(townPortalReturn?.annotations).toEqual(writeAnnotations);
    expect(TownPortalReturnInputSchema.safeParse({
      repo_id: "shared-agent-bridge",
      lab_mode: "town_portal_advisory_v0",
      portal: { kind: "town_portal" },
      payload: { kind: "bridge_status_lab_note" },
      current_state_hash: "sha256:" + "0".repeat(64),
      turn_id: "turn-001"
    }).success).toBe(true);
    expect(TownPortalReturnInputSchema.safeParse({
      repo_id: "shared-agent-bridge",
      production_mode: "town_portal_production_v0",
      portal: { kind: "town_portal" },
      payload: { kind: "bridge_status_lab_note" },
      current_state_hash: "sha256:" + "0".repeat(64),
      turn_id: "turn-001"
    }).success).toBe(true);
    expect(TownPortalReturnInputSchema.safeParse({
      repo_id: "shared-agent-bridge",
      portal: { kind: "town_portal" },
      payload: { kind: "bridge_status_lab_note" },
      current_state_hash: "sha256:" + "0".repeat(64),
      turn_id: "turn-001"
    }).success).toBe(true);
    expect(lastWrite).toBeDefined();
    expect(lastWrite?.inputSchema).toBe(LastWriteInputSchema);
    expect(lastWrite?.outputSchema).toBe(LastWriteResultSchema);
    expect(lastWrite?.annotations).toEqual(readOnlyAnnotations);
    expect(repoRead).toBeDefined();
    expect(repoRead?.inputSchema).toBe(RepoReadInputSchema);
    expect(repoRead?.outputSchema).toBe(RepoReadResultSchema);
    expect(repoRead?.annotations).toEqual(readOnlyAnnotations);
    expect(repoProjectContext).toBeDefined();
    expect(repoProjectContext?.inputSchema).toBe(RepoProjectContextInputSchema);
    expect(repoProjectContext?.outputSchema).toBe(RepoProjectContextResultSchema);
    expect(repoProjectContext?.annotations).toEqual(readOnlyAnnotations);
    expect(decisionMemory).toBeDefined();
    expect(decisionMemory?.inputSchema).toBe(DecisionLogInputSchema);
    expect(decisionMemory?.outputSchema).toBe(DecisionLogResultSchema);
    expect(decisionMemory?.annotations).toEqual(readOnlyAnnotations);
    expect(projectMemory).toBeDefined();
    expect(projectMemory?.annotations).toEqual(readOnlyAnnotations);
    expect(toolCatalog.some((tool) => (tool.name as string) === "repo_decision_log")).toBe(false);
    expect((toolContracts as Record<string, unknown>).repo_decision_log).toBeUndefined();
    expect(writeFile).toBeDefined();
    expect(writeFile?.inputSchema).toBe(WriteFileInputSchema);
    expect(writeFile?.outputSchema).toBe(WriteFileResultSchema);
    expect(writeFile?.annotations).toEqual(writeAnnotations);
    expect(writeChanges).toBeDefined();
    expect(writeChanges?.inputSchema).toBe(WriteChangesInputSchema);
    expect(writeChanges?.outputSchema).toBe(WriteChangesResultSchema);
    expect(writeChanges?.annotations).toEqual(writeAnnotations);
    expect(writeHandoff).toBeDefined();
    expect(writeHandoff?.inputSchema).toBe(HandoffInputSchema);
    expect(writeHandoff?.outputSchema).toBe(HandoffResultSchema);
    expect(writeHandoff?.annotations).toEqual(writeAnnotations);
    expect(stageCommit).toBeDefined();
    expect(stageCommit?.inputSchema).toBe(GitStageCommitInputSchema);
    expect(stageCommit?.outputSchema).toBe(GitStageCommitResultSchema);
    expect(stageCommit?.annotations).toEqual(writeAnnotations);
    expect(recover).toBeDefined();
    expect(recover?.inputSchema).toBe(GitRecoverInputSchema);
    expect(recover?.outputSchema).toBe(GitRecoverResultSchema);
    expect(recover?.annotations).toEqual(writeAnnotations);
    const restorePaths = toolCatalog.find((tool) => tool.name === "repo_git_restore_paths");
    expect(restorePaths).toBeDefined();
    expect(restorePaths?.inputSchema).toBe(GitRestorePathsInputSchema);
    expect(restorePaths?.outputSchema).toBe(GitRestorePathsResultSchema);
    expect(restorePaths?.annotations).toEqual(writeAnnotations);

    expect(toolContracts.repo_write_stage.input).toBe(toolContracts.repo_git_stage.input);
    expect(toolContracts.repo_write_stage.output).toBe(toolContracts.repo_git_stage.output);
    expect(toolContracts.repo_write_unstage.input).toBe(toolContracts.repo_git_unstage.input);
    expect(toolContracts.repo_write_unstage.output).toBe(toolContracts.repo_git_unstage.output);
    expect(toolContracts.repo_write_commit.input).toBe(toolContracts.repo_git_commit.input);
    expect(toolContracts.repo_write_commit.output).toBe(toolContracts.repo_git_commit.output);
    expect(isMutatingToolName("repo_git_review")).toBe(false);
    expect(isMutatingToolName("repo_last_write")).toBe(false);
  });

  test("keeps agent_runner_status as a compatibility alias for cached connector sessions", () => {
    const agentRunnerStatus = toolCatalog.find((tool) => tool.name === "agent_runner_status");
    const repoRunnerStatus = toolCatalog.find((tool) => tool.name === "repo_runner_status");

    expect(agentRunnerStatus).toBeDefined();
    expect(repoRunnerStatus).toBeDefined();
    expect(agentRunnerStatus?.inputSchema).toBe(repoRunnerStatus?.inputSchema);
    expect(agentRunnerStatus?.outputSchema).toBe(repoRunnerStatus?.outputSchema);
    expect(agentRunnerStatus?.annotations).toEqual(readOnlyAnnotations);
  });

  test("read-only planning tools are friendly to the single-repo ChatGPT app", () => {
    expect(ProjectBriefInputSchema.safeParse({}).success).toBe(true);
    expect(TaskInventoryInputSchema.safeParse({}).success).toBe(true);
    expect(DecisionLogInputSchema.safeParse({}).success).toBe(true);
    expect(schemaDescription(ProjectBriefInputSchema.shape.repo_id)).toContain("omit this");
    expect(JSON.stringify(ProjectBriefInputSchema.shape.repo_id)).not.toContain("shared-agent-bridge");

    expectFieldDescriptions([
      ["repo_project_context.repo_id", RepoProjectContextInputSchema.shape.repo_id],
      ["repo_project_context.mode", RepoProjectContextInputSchema.shape.mode],
      ["repo_project_context.goal", RepoProjectContextInputSchema.shape.goal],
      ["repo_read.repo_id", RepoReadInputSchema.shape.repo_id],
      ["repo_read.mode", RepoReadInputSchema.shape.mode],
      ["repo_read.path", RepoReadInputSchema.shape.path],
      ["repo_read.query", RepoReadInputSchema.shape.query],
      ["repo_project_brief.repo_id", ProjectBriefInputSchema.shape.repo_id],
      ["repo_project_brief.include", ProjectBriefInputSchema.shape.include],
      ["repo_task_inventory.repo_id", TaskInventoryInputSchema.shape.repo_id],
      ["repo_task_inventory.include_globs", TaskInventoryInputSchema.shape.include_globs],
      ["repo_task_inventory.exclude_globs", TaskInventoryInputSchema.shape.exclude_globs],
      ["repo_task_inventory.labels", TaskInventoryInputSchema.shape.labels],
      ["repo_task_inventory.max_results", TaskInventoryInputSchema.shape.max_results],
      ["repo_decision_memory.repo_id", DecisionLogInputSchema.shape.repo_id],
      ["repo_decision_memory.include_sources", DecisionLogInputSchema.shape.include_sources]
    ]);

    expect(GitCommitInputSchema.safeParse({
      message: "test commit",
      expected_head_sha: "0".repeat(40),
      expected_staged_paths: ["docs/example.md"]
    }).success).toBe(false);
  });

  test("handoff intent is routed to repo_write_handoff description only", () => {
    const writeFile = toolCatalog.find((tool) => tool.name === "repo_write_file");
    const writeChanges = toolCatalog.find((tool) => tool.name === "repo_write_changes");
    const writeHandoff = toolCatalog.find((tool) => tool.name === "repo_write_handoff");
    const handoffTerms = /handoff|handoffs|resume note|session handoff/i;

    expect(writeFile?.description).not.toMatch(handoffTerms);
    expect(writeChanges?.description).not.toMatch(handoffTerms);

    expect(writeHandoff?.description).toContain("skapa handoff");
    expect(writeHandoff?.description).toContain("create handoff");
    expect(writeHandoff?.description).toContain("skriv handoff");
    expect(writeHandoff?.description).toContain("session handoff");
    expect(writeHandoff?.description).toContain("resume note");
    expect(writeHandoff?.description).toContain("local-only ChatGPT handoff");
    expect(writeHandoff?.description).toContain("current.local.md");
    expect(writeHandoff?.description).toContain(".chatgpt/handoffs/*.local.md");
  });

  test("receipt files are ignored by git", () => {
    const gitignore = readFileSync(".gitignore", "utf8");

    expect(gitignore).toContain(".chatgpt/operations/*.json");
  });

  test("repo_git_review is read-only and does not expose no-op diff hunk input", () => {
    const reviewTool = toolCatalog.find((tool) => tool.name === "repo_git_review");

    expect(reviewTool?.annotations).toEqual(readOnlyAnnotations);
    expect(Object.keys(reviewTool?.inputSchema.shape ?? {}).sort()).toEqual([
      "max_files",
      "mode",
      "repo_id"
    ]);
  });

  test("repo_runner_status exposes a ChatGPT-friendly tool schema", () => {
    const tool = toolCatalog.find((tool) => tool.name === "repo_runner_status");
    expect(tool).toBeDefined();

    expect(Object.keys(tool?.inputSchema.shape ?? {}).sort()).toEqual([
      "capability_id",
      "detail",
      "heartbeat_stale_seconds",
      "hermes_board",
      "hermes_cursor",
      "hermes_transaction",
      "live_tail_max_events",
      "poll_count",
      "poll_interval_seconds",
      "portal_id",
      "repo_id",
      "stale_lock_seconds"
    ]);
    expect(tool?.inputSchema.safeParse({
      repo_id: "fixture",
      capability_id: "town_portal",
      portal_id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
      hermes_board: "hermes-intake-chatgpt-swarm-commit-push-m-repos-2026-06-29",
      poll_count: 4,
      poll_interval_seconds: 15,
      detail: "full"
    }).success).toBe(true);
    expect(tool?.inputSchema.safeParse({
      repo_id: "fixture",
      poll_count: 5
    }).success).toBe(false);
    expect(tool?.inputSchema.safeParse({
      repo_id: "fixture",
      poll_interval_seconds: 4
    }).success).toBe(false);
    expect(tool?.outputSchema.shape.poll_history).toBeUndefined();
    expect(tool?.outputSchema.shape.worker_slots).toBeUndefined();
    expect(tool?.outputSchema.shape.active_run_live_tail).toBeUndefined();
    expect(tool?.outputSchema.shape.ready_results).toBeDefined();

    const serialized = JSON.stringify(tool?.outputSchema.toJSONSchema?.() ?? tool?.outputSchema.shape);

    expect(serialized).toContain("module_registry");
    expect(serialized).not.toContain("anyOf");
    expect(serialized).not.toContain("propertyNames");
    expect(serialized).not.toContain("safe_actions");
    expect(serialized).not.toContain("result_text");
    expect(serialized).not.toContain("worker_slots");
    expect(serialized).not.toContain("active_run_live_tail");
    expect(serialized).not.toContain("poll_history");
    expect(serialized.length).toBeLessThan(7500);
  });

  test("repo_hermes_intake exposes a ChatGPT-friendly tool schema", () => {
    const tool = toolCatalog.find((candidate) => candidate.name === "repo_hermes_intake");
    expect(tool).toBeDefined();

    const serialized = JSON.stringify({
      input: tool?.inputSchema.toJSONSchema?.() ?? tool?.inputSchema.shape,
      output: tool?.outputSchema.toJSONSchema?.() ?? tool?.outputSchema.shape
    });

    expect(serialized).not.toContain("anyOf");
    expect(serialized).not.toContain("oneOf");
    expect(serialized).not.toContain("propertyNames");
    expect(serialized).not.toContain("\"default\"");
  });

  test("repo_git_review audit metadata omits changed path lists", () => {
    const event = createAuditEvent({
      tool: "repo_git_review",
      repo_id: "fixture",
      counts: { changed: 2, recommended: 1 },
      truncated: false,
      warnings: []
    });

    expect(event).toEqual({
      observed_at: expect.any(String),
      tool: "repo_git_review",
      repo_id: "fixture",
      counts: { changed: 2, recommended: 1 },
      truncated: false,
      warnings: []
    });
    expect("paths" in event).toBe(false);
  });

  test("mutating tool schemas describe every input and output field", () => {
    expectFieldDescriptions([
      ["repo_last_write.repo_id", LastWriteInputSchema.shape.repo_id],
      ["repo_last_write.ok", LastWriteResultSchema.shape.ok],
      ["repo_last_write.found", LastWriteResultSchema.shape.found],
      ["repo_last_write.receipt", LastWriteResultSchema.shape.receipt],
      ["repo_last_write.next_tool_payloads", LastWriteResultSchema.shape.next_tool_payloads],
      ["repo_last_write.warnings", LastWriteResultSchema.shape.warnings],
      ["repo_write_file.repo_id", WriteFileInputSchema.shape.repo_id],
      ["repo_write_file.path", WriteFileInputSchema.shape.path],
      ["repo_write_file.action", WriteFileInputSchema.shape.action],
      ["repo_write_file.content", WriteFileInputSchema.shape.content],
      ["repo_write_file.find", WriteFileInputSchema.shape.find],
      ["repo_write_file.replace", WriteFileInputSchema.shape.replace],
      ["repo_write_file.create_dirs", WriteFileInputSchema.shape.create_dirs],
      ["repo_write_file.dry_run", WriteFileInputSchema.shape.dry_run],
      ["repo_write_file.reason", WriteFileInputSchema.shape.reason],
      ["repo_write_file.ok", WriteFileResultSchema.shape.ok],
      ["repo_write_file.path", WriteFileResultSchema.shape.path],
      ["repo_write_file.action", WriteFileResultSchema.shape.action],
      ["repo_write_file.dry_run", WriteFileResultSchema.shape.dry_run],
      ["repo_write_file.changed", WriteFileResultSchema.shape.changed],
      ["repo_write_file.created", WriteFileResultSchema.shape.created],
      ["repo_write_file.bytes_written", WriteFileResultSchema.shape.bytes_written],
      ["repo_write_file.old_sha256", WriteFileResultSchema.shape.old_sha256],
      ["repo_write_file.new_sha256", WriteFileResultSchema.shape.new_sha256],
      ["repo_write_file.summary", WriteFileResultSchema.shape.summary],
      ["repo_write_file.warnings", WriteFileResultSchema.shape.warnings],
      ["repo_write_file.operation_receipt", WriteFileResultSchema.shape.operation_receipt]
    ]);

    expectFieldDescriptions([
      ["repo_write_changes.repo_id", WriteChangesInputSchema.shape.repo_id],
      ["repo_write_changes.changes", WriteChangesInputSchema.shape.changes],
      ["repo_write_changes.dry_run", WriteChangesInputSchema.shape.dry_run],
      ["repo_write_changes.reason", WriteChangesInputSchema.shape.reason],
      ["repo_write_changes.ok", WriteChangesResultSchema.shape.ok],
      ["repo_write_changes.dry_run", WriteChangesResultSchema.shape.dry_run],
      ["repo_write_changes.changed_paths", WriteChangesResultSchema.shape.changed_paths],
      ["repo_write_changes.files", WriteChangesResultSchema.shape.files],
      ["repo_write_changes.files.path", WriteChangesResultSchema.shape.files.element.shape.path],
      ["repo_write_changes.files.type", WriteChangesResultSchema.shape.files.element.shape.type],
      ["repo_write_changes.files.changed", WriteChangesResultSchema.shape.files.element.shape.changed],
      ["repo_write_changes.files.created", WriteChangesResultSchema.shape.files.element.shape.created],
      ["repo_write_changes.files.bytes_written", WriteChangesResultSchema.shape.files.element.shape.bytes_written],
      ["repo_write_changes.files.old_sha256", WriteChangesResultSchema.shape.files.element.shape.old_sha256],
      ["repo_write_changes.files.new_sha256", WriteChangesResultSchema.shape.files.element.shape.new_sha256],
      ["repo_write_changes.files.summary", WriteChangesResultSchema.shape.files.element.shape.summary],
      ["repo_write_changes.counts", WriteChangesResultSchema.shape.counts],
      ["repo_write_changes.counts.requested", WriteChangesResultSchema.shape.counts.shape.requested],
      ["repo_write_changes.counts.changed", WriteChangesResultSchema.shape.counts.shape.changed],
      ["repo_write_changes.counts.created", WriteChangesResultSchema.shape.counts.shape.created],
      ["repo_write_changes.counts.unchanged", WriteChangesResultSchema.shape.counts.shape.unchanged],
      ["repo_write_changes.summary", WriteChangesResultSchema.shape.summary],
      ["repo_write_changes.warnings", WriteChangesResultSchema.shape.warnings],
      ["repo_write_changes.next_steps", WriteChangesResultSchema.shape.next_steps],
      ["repo_write_changes.operation_receipt", WriteChangesResultSchema.shape.operation_receipt]
    ]);

    expectFieldDescriptions([
      ["repo_write_handoff.repo_id", HandoffInputSchema.shape.repo_id],
      ["repo_write_handoff.title", HandoffInputSchema.shape.title],
      ["repo_write_handoff.current_track", HandoffInputSchema.shape.current_track],
      ["repo_write_handoff.current_state", HandoffInputSchema.shape.current_state],
      ["repo_write_handoff.why", HandoffInputSchema.shape.why],
      ["repo_write_handoff.completed_work", HandoffInputSchema.shape.completed_work],
      ["repo_write_handoff.decisions", HandoffInputSchema.shape.decisions],
      ["repo_write_handoff.workflow", HandoffInputSchema.shape.workflow],
      ["repo_write_handoff.constraints", HandoffInputSchema.shape.constraints],
      ["repo_write_handoff.next_steps", HandoffInputSchema.shape.next_steps],
      ["repo_write_handoff.important_files", HandoffInputSchema.shape.important_files],
      ["repo_write_handoff.risks", HandoffInputSchema.shape.risks],
      ["repo_write_handoff.open_questions", HandoffInputSchema.shape.open_questions],
      ["repo_write_handoff.update_current", HandoffInputSchema.shape.update_current],
      ["repo_write_handoff.dry_run", HandoffInputSchema.shape.dry_run],
      ["repo_write_handoff.ok", HandoffResultSchema.shape.ok],
      ["repo_write_handoff.dry_run", HandoffResultSchema.shape.dry_run],
      ["repo_write_handoff.handoff_path", HandoffResultSchema.shape.handoff_path],
      ["repo_write_handoff.current_path", HandoffResultSchema.shape.current_path],
      ["repo_write_handoff.updated_current", HandoffResultSchema.shape.updated_current],
      ["repo_write_handoff.branch", HandoffResultSchema.shape.branch],
      ["repo_write_handoff.head_sha", HandoffResultSchema.shape.head_sha],
      ["repo_write_handoff.clean", HandoffResultSchema.shape.clean],
      ["repo_write_handoff.startup_prompt", HandoffResultSchema.shape.startup_prompt],
      ["repo_write_handoff.current_next_step", HandoffResultSchema.shape.current_next_step],
      ["repo_write_handoff.warnings", HandoffResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_git_stage.repo_id", GitStageInputSchema.shape.repo_id],
      ["repo_git_stage.paths", GitStageInputSchema.shape.paths],
      ["repo_git_stage.expected_head_sha", GitStageInputSchema.shape.expected_head_sha],
      ["repo_git_stage.dry_run", GitStageInputSchema.shape.dry_run],
      ["repo_git_stage.reason", GitStageInputSchema.shape.reason],
      ["repo_git_stage.ok", GitStageResultSchema.shape.ok],
      ["repo_git_stage.dry_run", GitStageResultSchema.shape.dry_run],
      ["repo_git_stage.head_sha", GitStageResultSchema.shape.head_sha],
      ["repo_git_stage.staged_paths", GitStageResultSchema.shape.staged_paths],
      ["repo_git_stage.skipped", GitStageResultSchema.shape.skipped],
      ["repo_git_stage.skipped.path", GitStageResultSchema.shape.skipped.element.shape.path],
      ["repo_git_stage.skipped.reason", GitStageResultSchema.shape.skipped.element.shape.reason],
      ["repo_git_stage.warnings", GitStageResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_git_unstage.repo_id", GitUnstageInputSchema.shape.repo_id],
      ["repo_git_unstage.paths", GitUnstageInputSchema.shape.paths],
      ["repo_git_unstage.expected_head_sha", GitUnstageInputSchema.shape.expected_head_sha],
      ["repo_git_unstage.dry_run", GitUnstageInputSchema.shape.dry_run],
      ["repo_git_unstage.reason", GitUnstageInputSchema.shape.reason],
      ["repo_git_unstage.ok", GitUnstageResultSchema.shape.ok],
      ["repo_git_unstage.dry_run", GitUnstageResultSchema.shape.dry_run],
      ["repo_git_unstage.head_sha", GitUnstageResultSchema.shape.head_sha],
      ["repo_git_unstage.unstaged_paths", GitUnstageResultSchema.shape.unstaged_paths],
      ["repo_git_unstage.skipped", GitUnstageResultSchema.shape.skipped],
      ["repo_git_unstage.skipped.path", GitUnstageResultSchema.shape.skipped.element.shape.path],
      ["repo_git_unstage.skipped.reason", GitUnstageResultSchema.shape.skipped.element.shape.reason],
      ["repo_git_unstage.warnings", GitUnstageResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_git_restore_paths.repo_id", GitRestorePathsInputSchema.shape.repo_id],
      ["repo_git_restore_paths.paths", GitRestorePathsInputSchema.shape.paths],
      ["repo_git_restore_paths.expected_head_sha", GitRestorePathsInputSchema.shape.expected_head_sha],
      ["repo_git_restore_paths.dry_run", GitRestorePathsInputSchema.shape.dry_run],
      ["repo_git_restore_paths.reason", GitRestorePathsInputSchema.shape.reason],
      ["repo_git_restore_paths.ok", GitRestorePathsResultSchema.shape.ok],
      ["repo_git_restore_paths.dry_run", GitRestorePathsResultSchema.shape.dry_run],
      ["repo_git_restore_paths.head_sha", GitRestorePathsResultSchema.shape.head_sha],
      ["repo_git_restore_paths.restored_paths", GitRestorePathsResultSchema.shape.restored_paths],
      ["repo_git_restore_paths.skipped", GitRestorePathsResultSchema.shape.skipped],
      ["repo_git_restore_paths.skipped.path", GitRestorePathsResultSchema.shape.skipped.element.shape.path],
      ["repo_git_restore_paths.skipped.reason", GitRestorePathsResultSchema.shape.skipped.element.shape.reason],
      ["repo_git_restore_paths.warnings", GitRestorePathsResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_git_commit.repo_id", GitCommitInputSchema.shape.repo_id],
      ["repo_git_commit.message", GitCommitInputSchema.shape.message],
      ["repo_git_commit.expected_head_sha", GitCommitInputSchema.shape.expected_head_sha],
      ["repo_git_commit.expected_staged_paths", GitCommitInputSchema.shape.expected_staged_paths],
      ["repo_git_commit.dry_run", GitCommitInputSchema.shape.dry_run],
      ["repo_git_commit.reason", GitCommitInputSchema.shape.reason],
      ["repo_git_commit.ok", GitCommitResultSchema.shape.ok],
      ["repo_git_commit.dry_run", GitCommitResultSchema.shape.dry_run],
      ["repo_git_commit.head_before", GitCommitResultSchema.shape.head_before],
      ["repo_git_commit.head_after", GitCommitResultSchema.shape.head_after],
      ["repo_git_commit.commit_sha", GitCommitResultSchema.shape.commit_sha],
      ["repo_git_commit.committed_paths", GitCommitResultSchema.shape.committed_paths],
      ["repo_git_commit.warnings", GitCommitResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_write_stage_commit.repo_id", GitStageCommitInputSchema.shape.repo_id],
      ["repo_write_stage_commit.paths", GitStageCommitInputSchema.shape.paths],
      ["repo_write_stage_commit.message", GitStageCommitInputSchema.shape.message],
      ["repo_write_stage_commit.expected_head_sha", GitStageCommitInputSchema.shape.expected_head_sha],
      ["repo_write_stage_commit.dry_run", GitStageCommitInputSchema.shape.dry_run],
      ["repo_write_stage_commit.reason", GitStageCommitInputSchema.shape.reason],
      ["repo_write_stage_commit.ok", GitStageCommitResultSchema.shape.ok],
      ["repo_write_stage_commit.dry_run", GitStageCommitResultSchema.shape.dry_run],
      ["repo_write_stage_commit.head_before", GitStageCommitResultSchema.shape.head_before],
      ["repo_write_stage_commit.head_after", GitStageCommitResultSchema.shape.head_after],
      ["repo_write_stage_commit.commit_sha", GitStageCommitResultSchema.shape.commit_sha],
      ["repo_write_stage_commit.staged_paths", GitStageCommitResultSchema.shape.staged_paths],
      ["repo_write_stage_commit.committed_paths", GitStageCommitResultSchema.shape.committed_paths],
      ["repo_write_stage_commit.remaining_changes", GitStageCommitResultSchema.shape.remaining_changes],
      ["repo_write_stage_commit.clean_after", GitStageCommitResultSchema.shape.clean_after],
      ["repo_write_stage_commit.warnings", GitStageCommitResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_write_recover.repo_id", GitRecoverInputSchema.shape.repo_id],
      ["repo_write_recover.expected_head_sha", GitRecoverInputSchema.shape.expected_head_sha],
      ["repo_write_recover.unstage_paths", GitRecoverInputSchema.shape.unstage_paths],
      ["repo_write_recover.restore_paths", GitRecoverInputSchema.shape.restore_paths],
      ["repo_write_recover.cleanup_paths", GitRecoverInputSchema.shape.cleanup_paths],
      ["repo_write_recover.dry_run", GitRecoverInputSchema.shape.dry_run],
      ["repo_write_recover.reason", GitRecoverInputSchema.shape.reason],
      ["repo_write_recover.ok", GitRecoverResultSchema.shape.ok],
      ["repo_write_recover.dry_run", GitRecoverResultSchema.shape.dry_run],
      ["repo_write_recover.head_sha", GitRecoverResultSchema.shape.head_sha],
      ["repo_write_recover.unstaged_paths", GitRecoverResultSchema.shape.unstaged_paths],
      ["repo_write_recover.restored_paths", GitRecoverResultSchema.shape.restored_paths],
      ["repo_write_recover.deleted", GitRecoverResultSchema.shape.deleted],
      ["repo_write_recover.deleted.path", GitRecoverResultSchema.shape.deleted.element.shape.path],
      ["repo_write_recover.deleted.type", GitRecoverResultSchema.shape.deleted.element.shape.type],
      ["repo_write_recover.skipped", GitRecoverResultSchema.shape.skipped],
      ["repo_write_recover.skipped.path", GitRecoverResultSchema.shape.skipped.element.shape.path],
      ["repo_write_recover.skipped.reason", GitRecoverResultSchema.shape.skipped.element.shape.reason],
      ["repo_write_recover.remaining_changes", GitRecoverResultSchema.shape.remaining_changes],
      ["repo_write_recover.clean_after", GitRecoverResultSchema.shape.clean_after],
      ["repo_write_recover.warnings", GitRecoverResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_cleanup_paths.repo_id", CleanupPathsInputSchema.shape.repo_id],
      ["repo_cleanup_paths.paths", CleanupPathsInputSchema.shape.paths],
      ["repo_cleanup_paths.dry_run", CleanupPathsInputSchema.shape.dry_run],
      ["repo_cleanup_paths.reason", CleanupPathsInputSchema.shape.reason],
      ["repo_cleanup_paths.ok", CleanupPathsResultSchema.shape.ok],
      ["repo_cleanup_paths.dry_run", CleanupPathsResultSchema.shape.dry_run],
      ["repo_cleanup_paths.deleted", CleanupPathsResultSchema.shape.deleted],
      ["repo_cleanup_paths.deleted.path", CleanupPathsResultSchema.shape.deleted.element.shape.path],
      ["repo_cleanup_paths.deleted.type", CleanupPathsResultSchema.shape.deleted.element.shape.type],
      ["repo_cleanup_paths.skipped", CleanupPathsResultSchema.shape.skipped],
      ["repo_cleanup_paths.skipped.path", CleanupPathsResultSchema.shape.skipped.element.shape.path],
      ["repo_cleanup_paths.skipped.reason", CleanupPathsResultSchema.shape.skipped.element.shape.reason],
      ["repo_cleanup_paths.warnings", CleanupPathsResultSchema.shape.warnings]
    ]);
  });

  test("repo_write_changes schema accepts grouped same-file exact-match edits", () => {
    const parsed = WriteChangesInputSchema.safeParse({
      repo_id: "fixture",
      changes: [
        {
          type: "edit",
          path: "src/app.ts",
          edits: [
            { type: "replace", find: "const enabled = false;", replace: "const enabled = true;" },
            { type: "insert_before", find: "export function run() {", content: "const started = true;\n" },
            { type: "insert_after", find: "export function run() {", content: "\n  console.log('running');" }
          ]
        }
      ]
    });

    expect(parsed.error?.issues).toBeUndefined();
  });

  test("repo_write_changes schema rejects unsupported grouped edit operations", () => {
    const parsed = WriteChangesInputSchema.safeParse({
      repo_id: "fixture",
      changes: [
        {
          type: "edit",
          path: "src/app.ts",
          edits: [
            { type: "append", find: "export function run() {", content: "unsupported\n" }
          ]
        }
      ]
    });

    expect(parsed.success).toBe(false);
  });

  test("repo_git_review schema accepts composite recover payloads", () => {
    const parsed = GitReviewResultSchema.safeParse({
      ok: true,
      branch: "main",
      head_sha: "0".repeat(40),
      clean: false,
      changed_paths: [],
      diff_summary: {
        file_count: 0,
        truncated: false,
        files: []
      },
      recommendation: {
        ready_to_stage: false,
        recommended_stage_paths: [],
        excluded_paths: [],
        suggested_commit_message: "No changes to commit",
        risk_level: "low",
        warnings: []
      },
      next_tool_payloads: {
        repo_write_recover_dry_run: {
          repo_id: "fixture",
          expected_head_sha: "0".repeat(40),
          unstage_paths: ["docs/a.md"],
          restore_paths: ["docs/a.md"],
          cleanup_paths: [".chatgpt/tool-tests/generated.md"],
          dry_run: true
        },
        repo_write_recover_actual: {
          repo_id: "fixture",
          expected_head_sha: "0".repeat(40),
          unstage_paths: ["docs/a.md"],
          restore_paths: ["docs/a.md"],
          cleanup_paths: [".chatgpt/tool-tests/generated.md"],
          dry_run: false
        }
      }
    });

    expect(parsed.error?.issues).toBeUndefined();
  });

  test("operations policy schema includes safe git operation defaults", () => {
    const parsed = RepoReaderConfigSchema.safeParse({
      repos: [{
        repo_id: "fixture",
        display_name: "Fixture",
        root: "/tmp/fixture",
        operations: {
          enabled: true,
          git_stage_enabled: true,
          git_commit_enabled: true,
          max_paths_per_operation: 25
        }
      }],
      limits: {}
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.repos[0]?.operations).toMatchObject({
      enabled: true,
      git_stage_enabled: true,
      git_commit_enabled: true,
      max_paths_per_operation: 25
    });

    expect(parsed.data?.repos[0]?.operations).toMatchObject({
      cleanup_enabled: false,
      cleanup_allowed_globs: [
        ".chatgpt/tool-tests/**",
        ".chatgpt/backups/**",
        ".chatgpt/audits/**",
        ".chatgpt/backlog/**",
        ".chatgpt/codex-runs/**",
        "coverage/**",
        "dist/**",
        "test-results/**"
      ]
    });
    expect(RepoReaderConfigSchema.parse({
      repos: [{ repo_id: "fixture", display_name: "Fixture", root: "/tmp/fixture" }],
      limits: {}
    }).repos[0]?.operations).toEqual({
      enabled: false,
      git_stage_enabled: false,
      git_commit_enabled: false,
      max_paths_per_operation: 50,
      cleanup_enabled: false,
      cleanup_allowed_globs: [
        ".chatgpt/tool-tests/**",
        ".chatgpt/backups/**",
        ".chatgpt/audits/**",
        ".chatgpt/backlog/**",
        ".chatgpt/codex-runs/**",
        "coverage/**",
        "dist/**",
        "test-results/**"
      ]
    });
  });

  test("write policy schema exposes current defaults without legacy backup config", () => {
    const parsed = RepoReaderConfigSchema.safeParse({
      repos: [{
        repo_id: "fixture",
        display_name: "Fixture",
        root: "/tmp/fixture",
        writes: {
          enabled: true
        }
      }],
      limits: {}
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.repos[0]?.writes.max_bytes_per_write).toBe(1048576);

    const defaultWrites = RepoReaderConfigSchema.parse({
      repos: [{ repo_id: "fixture", display_name: "Fixture", root: "/tmp/fixture" }],
      limits: {}
    }).repos[0]?.writes;
    expect(defaultWrites?.max_bytes_per_write).toBe(1048576);
    expect(defaultWrites?.allowed_globs).toEqual([
      ".chatgpt/**",
      ".codex/**",
      "docs/**",
      "README.md",
      "CHANGELOG.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "CODE_OF_CONDUCT.md",
      "SUPPORT.md",
      "LICENSE",
      ".gitignore"
    ]);
    expect(defaultWrites?.allowed_globs).toContain(".gitignore");
    expect(defaultWrites).not.toHaveProperty("require_expected_sha256_for_overwrite");
    expect(defaultWrites).not.toHaveProperty("create_backup_on_overwrite");
    expect(defaultWrites).not.toHaveProperty("backup_dir");
    expect(defaultWrites?.denied_globs).toContain("**/node_modules/**");
    expect(defaultWrites?.denied_globs).toContain("**/dist/**");
    expect(defaultWrites?.denied_globs).toContain("**/.next/**");
    expect(defaultWrites?.denied_globs).toContain("**/coverage/**");
    expect(defaultWrites?.denied_globs).not.toContain("**/*secret*");
    expect(defaultWrites?.denied_globs).not.toContain("**/*credential*");
  });

  test("config example is a valid empty starter config", () => {
    const raw = readFileSync("config.example.json", "utf8");
    const example = JSON.parse(raw) as { repos?: unknown[]; limits?: Record<string, unknown> };
    const parsed = RepoReaderConfigSchema.safeParse(example);

    expect(parsed.success).toBe(true);
    expect(example.repos).toEqual([]);
    expect(example.limits).toEqual({
      max_files: 50,
      max_bytes_per_file: 128000,
      max_total_bytes: 750000
    });
    expect(raw).not.toContain("/absolute/path/to/repo");
  });

  test("repo_read_many advertises exclude globs and file content output", () => {
    const readMany = toolCatalog.find((tool) => tool.name === "repo_read_many");
    expect(readMany?.inputSchema.shape.exclude_globs).toBeDefined();
    expect(readMany?.inputSchema.safeParse({ repo_id: "fixture" }).success).toBe(false);
    expect(readMany?.inputSchema.safeParse({ repo_id: "fixture", paths: ["README.md"] }).success).toBe(true);
    expect(readMany?.inputSchema.safeParse({ repo_id: "fixture", include_globs: ["src/**/*.ts"] }).success).toBe(true);

    const outputSchema = readMany!.outputSchema;
    const parsed = outputSchema.safeParse({
      files: [{
        path: "README.md",
        size_bytes: 10,
        sha256: "abc",
        total_lines: 1,
        start_line: 1,
        end_line: 1,
        truncated: false,
        text: "hello",
        warnings: []
      }],
      skipped: [],
      matched_count: 1,
      returned_count: 1,
      truncated: false
    });
    expect(parsed.success).toBe(true);

    const missingFileFields = outputSchema.safeParse({
      files: [{ path: "README.md" }],
      skipped: [],
      matched_count: 1,
      returned_count: 1,
      truncated: false
    });
    expect(missingFileFields.success).toBe(false);
  });

  test("repo_git_diff advertises minimal first-call guidance", () => {
    const gitDiff = toolCatalog.find((tool) => tool.name === "repo_git_diff");

    expect(gitDiff?.description).toContain("Default first call should pass only repo_id");
    expect(gitDiff?.description).toContain("Do not include staged, unstaged, paths, max_bytes, or context_lines on the first pass");
    expect(schemaDescription(gitDiff!.inputSchema.shape.max_bytes)).toContain("Second-pass refinement");
    expect(schemaDescription(gitDiff!.inputSchema.shape.context_lines)).toContain("Omit on the first diff call");
  });

  test("every tool uses the central contract objects", () => {
    const hiddenContractTools = new Set([
      "repo_connector_whoami",
      "repo_plan_review",
      "repo_policy_explain",
      "repo_prepare_codex_task",
      "repo_vision_routes"
    ]);

    expect(toolCatalog.map((tool) => tool.name).sort()).toEqual(
      Object.keys(toolContracts).filter((name) => !hiddenContractTools.has(name)).sort()
    );

    for (const tool of toolCatalog) {
      const contract = toolContracts[tool.name];
      expect(tool.inputSchema).toBe(contract.input);
      expect(tool.outputSchema).toBe(contract.output);
    }
  });

  test("exposed tool surface shape stays stable", () => {
    const surface = toolCatalog.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: tool.annotations,
      inputKeys: Object.keys(tool.inputSchema.shape).sort(),
      outputKeys: Object.keys(tool.outputSchema.shape).sort()
    }));
    const names = surface.map((tool) => tool.name);
    const concierge = surface.find((tool) => tool.name === "repo_bridge_concierge");
    const liveTail = surface.find((tool) => tool.name === "repo_run_live_tail");
    const runnerStatus = surface.find((tool) => tool.name === "repo_runner_status");
    const appserverTurn = surface.find((tool) => tool.name === "repo_codex_appserver_turn");
    const townPortalReturn = surface.find((tool) => tool.name === "repo_town_portal_return");
    const hermesIntake = surface.find((tool) => tool.name === "repo_hermes_intake");
    const hermesIntervene = surface.find((tool) => tool.name === "repo_hermes_intervene");

    expect(names).toHaveLength(48);
    expect(names).toContain("repo_bridge_concierge");
    expect(names.indexOf("repo_hermes_intake")).toBeLessThan(3);
    expect(names).toContain("repo_read");
    expect(names).toContain("repo_run_live_tail");
    expect(names).toContain("repo_runner_status");
    expect(names).toContain("repo_last_write");
    expect(names).toContain("repo_project_context");
    expect(names).toContain("repo_project_memory");
    expect(names).toContain("repo_write_codex_tasks_batch");
    expect(names).toContain("repo_codex_appserver_turn");
    expect(names).toContain("repo_lab_exec");
    expect(names).toContain("repo_hermes_intake");
    expect(names).toContain("repo_hermes_intervene");
    expect(names).toContain("repo_hermes_cancel");
    expect(names).toContain("repo_hermes_kanban_command");
    expect(names).toContain("repo_hermes_watch");
    expect(names).toContain("repo_portfolio_action_command");
    expect(names).toContain("repo_town_portal_return");
    expect(names).toContain("agent_runner_status");
    expect(concierge?.inputKeys).toEqual(["include_evidence", "repo_id", "request"]);
    expect(concierge?.outputKeys).toEqual([
      "current_status",
      "destination",
      "evidence",
      "inferred",
      "known",
      "latest_progress",
      "mode",
      "next_tool_hints",
      "ok",
      "open_issues",
      "plain_text",
      "recommended_next_action",
      "repo_id",
      "request",
      "unknown",
      "warnings"
    ]);
    expect(runnerStatus?.inputKeys).toEqual([
      "capability_id",
      "detail",
      "heartbeat_stale_seconds",
      "hermes_board",
      "hermes_cursor",
      "hermes_transaction",
      "live_tail_max_events",
      "poll_count",
      "poll_interval_seconds",
      "portal_id",
      "repo_id",
      "stale_lock_seconds"
    ]);
    expect(runnerStatus?.outputKeys).toEqual([
      "active_count",
      "active_run_id",
      "active_run_ids",
      "blocked_count",
      "capability_summary",
      "central_queue",
      "completed_count",
      "detail_level",
      "details_truncated",
      "full_detail_hint",
      "ok",
      "pending_count",
      "plain_text",
      "ready_results",
      "repo_id",
      "runner",
      "runtime_assessment",
      "stale_lock_count",
      "warnings",
      "worker"
    ]);
    expect(appserverTurn).toMatchObject({
      title: "Send Codex app-server turn",
      inputKeys: [
        "acceptance_criteria",
        "allowed_paths",
        "app_server_url",
        "binding_id",
        "correlation_id",
        "dry_run",
        "forbidden_paths",
        "model",
        "objective",
        "repo_id",
        "target_thread_id",
        "timeout_seconds",
        "workstream"
      ],
      outputKeys: [
        "address",
        "app_server_url_scope",
        "binding_available",
        "binding_id",
        "bootstrap_used",
        "connection_status",
        "direct_send",
        "dry_run",
        "json_rpc_messages",
        "json_rpc_wire_note",
        "live_receipt",
        "next_proof_step",
        "ok",
        "proof_boundary",
        "repo_id",
        "status",
        "target_thread_id",
        "warnings",
        "workstream"
      ]
    });
    expect(hermesIntervene).toMatchObject({
      title: "Steer an active Hermes transaction",
      inputKeys: ["expected_evidence", "instruction", "intervention_type", "reason", "repo_id", "transaction_id"],
      outputKeys: ["checkpoint_path", "intervention_id", "intervention_type", "next_action", "observed_at", "ok", "operator_status", "receipt_path", "repo_id", "status", "transaction_id", "warnings"]
    });
    expect(liveTail).toMatchObject({
      title: "Show Codex run live tail",
      inputKeys: ["cursor", "max_events", "repo_id", "run_id"],
      outputKeys: [
        "events",
        "next_cursor",
        "ok",
        "repo_id",
        "result_path",
        "result_status",
        "run_id",
        "terminal",
        "warnings"
      ]
    });
    expect(townPortalReturn).toMatchObject({
      title: "Return through Town Portal",
      inputKeys: ["approval_present", "current_state_hash", "lab_mode", "payload", "portal", "production_mode", "repo_id", "turn_id"],
      outputKeys: [
        "adapter_called",
        "audit_receipt",
        "conflict",
        "consume_handle",
        "handoff",
        "kind",
        "reason",
        "status",
        "terminal"
      ]
    });
    expect(hermesIntake).toMatchObject({
      title: "Submit Hermes intake",
      inputKeys: ["board", "intake_markdown", "job_id", "max_output_bytes", "repo_id", "submit", "timeout_seconds", "title"],
      outputKeys: [
        "board",
        "duration_ms",
        "exit_code",
        "intake_path",
        "job_id",
        "manifest_path",
        "ok",
        "repo_id",
        "result_path",
        "result_read",
        "result_text",
        "spawned",
        "status",
        "stderr_tail",
        "stdout_tail",
        "submitted",
        "target",
        "timed_out",
        "warnings",
        "workspace"
      ]
    });
  });

  test("direct ChatGPT tools avoid connector-hostile schema keywords", () => {
    const directTools = toolCatalog.filter((tool) => chatGptDirectToolNames.has(tool.name));

    expect(directTools.map((tool) => tool.name).sort()).toEqual([
      "repo_bridge_concierge",
      "repo_hermes_cancel",
      "repo_hermes_intake",
      "repo_hermes_kanban_command",
      "repo_hermes_watch",
      "repo_portfolio_action_command",
      "repo_portfolio_report"
    ]);

    for (const tool of directTools) {
      const inputHits = findConnectorHostileSchemaKeywords(tool.inputSchema.toJSONSchema());
      const outputHits = findConnectorHostileSchemaKeywords(tool.outputSchema.toJSONSchema());
      expect([...inputHits, ...outputHits], `${tool.name} should be connector-compatible`).toEqual([]);
    }
  });

  test("catalog does not define inline zod schemas", () => {
    const source = readFileSync("src/tools/catalog.ts", "utf8");

    expect(source).not.toMatch(/\binputSchema:\s*{/);
    expect(source).not.toMatch(/\boutputSchema:\s*{/);
    expect(source).not.toMatch(/\bz\.(object|string|number|boolean|array|enum|record|union|literal)\s*\(/);
    expect(source).not.toMatch(/\.shape\b/);
  });
});
