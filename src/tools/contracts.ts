import type { z } from "zod";
import { AgentRunnerStatusInputSchema, AgentRunnerStatusReferenceResultSchema, RunLiveTailInputSchema, RunLiveTailResultSchema } from "../contracts/agent-runner.contract.js";
import { BridgeConciergeInputSchema, BridgeConciergeResultSchema } from "../contracts/bridge-concierge.contract.js";
import { CodexAppserverTurnInputSchema, CodexAppserverTurnResultSchema } from "../contracts/codex-appserver.contract.js";
import { ChangePlanInputSchema, ChangePlanResultSchema } from "../contracts/change-plan.contract.js";
import { CleanupPathsInputSchema, CleanupPathsResultSchema } from "../contracts/cleanup.contract.js";
import { CodexReviewInputSchema, CodexReviewResultSchema, CodexRunAndWaitInputSchema, CodexRunAndWaitResultSchema, CodexTaskBatchWriteInputSchema, CodexTaskBatchWriteResultSchema, CodexTaskInputSchema, CodexTaskResultSchema, CodexTaskWriteInputSchema, CodexTaskWriteResultSchema } from "../contracts/codex-task.contract.js";
import { ConnectorWhoamiInputSchema, ConnectorWhoamiResultSchema } from "../contracts/connector-whoami.contract.js";
import { DecisionLogInputSchema, DecisionLogResultSchema } from "../contracts/decision.contract.js";
import { FetchFileInputSchema, FileContentSchema, ReadManyInputSchema, ReadManyResultSchema } from "../contracts/file.contract.js";
import { GitCommitInputSchema, GitCommitResultSchema, GitRecoverInputSchema, GitRecoverResultSchema, GitRestorePathsInputSchema, GitRestorePathsResultSchema, GitStageCommitInputSchema, GitStageCommitResultSchema, GitStageInputSchema, GitStageResultSchema, GitUnstageInputSchema, GitUnstageResultSchema } from "../contracts/git-operations.contract.js";
import { GitDiffInputSchema, GitDiffResultSchema, GitStatusInputSchema, GitStatusResultSchema } from "../contracts/git.contract.js";
import { GitReviewInputSchema, GitReviewResultSchema } from "../contracts/git-review.contract.js";
import { HandoffInputSchema, HandoffResultSchema } from "../contracts/handoff.contract.js";
import { HermesIntakeInputSchema, HermesIntakeResultSchema } from "../contracts/hermes-intake.contract.js";
import { LabExecInputSchema, LabExecResultSchema } from "../contracts/lab-exec.contract.js";
import { TownPortalReturnInputSchema, TownPortalReturnResultSchema } from "../contracts/town-portal.contract.js";
import { NextActionInputSchema, NextActionResultSchema } from "../contracts/next-action.contract.js";
import { LastWriteInputSchema, LastWriteResultSchema } from "../contracts/operation-receipt.contract.js";
import { PolicyExplainInputSchema, PolicyExplainResultSchema } from "../contracts/policy.contract.js";
import { RepoProjectContextInputSchema, RepoProjectContextResultSchema } from "../contracts/project-context.contract.js";
import { ProjectBriefInputSchema, ProjectBriefResultSchema } from "../contracts/project.contract.js";
import { ProjectMemoryDashboardResultSchema, ProjectMemoryInputSchema } from "../contracts/project-memory.contract.js";
import { RepoReadInputSchema, RepoReadResultSchema } from "../contracts/read-hub.contract.js";
import { RepoInputSchema, RepoListInputSchema, RepoListReferenceResultSchema, RepoTreeInputSchema } from "../contracts/repo.contract.js";
import { PlanReviewInputSchema, PlanReviewResultSchema } from "../contracts/review.contract.js";
import { SearchInputSchema, SearchResponseSchema } from "../contracts/search.contract.js";
import { TaskInventoryInputSchema, TaskInventoryResultSchema } from "../contracts/task.contract.js";
import { RepoTreeResultSchema } from "../contracts/tree.contract.js";
import { VisionRouteInputSchema, VisionRouteResultSchema } from "../contracts/vision-route.contract.js";
import { WriteChangesInputSchema, WriteChangesResultSchema, WriteFileInputSchema, WriteFileResultSchema } from "../contracts/write.contract.js";

export type ToolName =
  | "repo_list_roots"
  | "repo_bridge_concierge"
  | "agent_runner_status"
  | "repo_runner_status"
  | "repo_run_live_tail"
  | "repo_connector_whoami"
  | "repo_vision_routes"
  | "repo_policy_explain"
  | "repo_last_write"
  | "repo_read"
  | "repo_tree"
  | "repo_search"
  | "repo_fetch_file"
  | "repo_read_many"
  | "repo_git_status"
  | "repo_git_diff"
  | "repo_git_review"
  | "repo_git_stage"
  | "repo_git_unstage"
  | "repo_git_restore_paths"
  | "repo_git_commit"
  | "repo_write_stage"
  | "repo_write_unstage"
  | "repo_write_commit"
  | "repo_write_stage_commit"
  | "repo_write_recover"
  | "repo_cleanup_paths"
  | "repo_project_context"
  | "repo_project_brief"
  | "repo_project_memory"
  | "repo_task_inventory"
  | "repo_decision_memory"
  | "repo_change_plan"
  | "repo_next_action"
  | "repo_plan_review"
  | "repo_prepare_codex_task"
  | "repo_write_codex_task"
  | "repo_write_codex_tasks_batch"
  | "repo_codex_appserver_turn"
  | "repo_codex_review"
  | "codex_run_and_wait"
  | "repo_lab_exec"
  | "repo_hermes_intake"
  | "repo_town_portal_return"
  | "repo_write_file"
  | "repo_write_changes"
  | "repo_write_handoff";

export type ToolContract = {
  input: z.ZodObject<z.ZodRawShape>;
  output: z.ZodObject<z.ZodRawShape>;
};

export const toolContracts = {
  repo_list_roots: {
    input: RepoListInputSchema,
    output: RepoListReferenceResultSchema
  },
  repo_bridge_concierge: {
    input: BridgeConciergeInputSchema,
    output: BridgeConciergeResultSchema
  },
  agent_runner_status: {
    input: AgentRunnerStatusInputSchema,
    output: AgentRunnerStatusReferenceResultSchema
  },
  repo_runner_status: {
    input: AgentRunnerStatusInputSchema,
    output: AgentRunnerStatusReferenceResultSchema
  },
  repo_run_live_tail: {
    input: RunLiveTailInputSchema,
    output: RunLiveTailResultSchema
  },
  repo_connector_whoami: {
    input: ConnectorWhoamiInputSchema,
    output: ConnectorWhoamiResultSchema
  },
  repo_vision_routes: {
    input: VisionRouteInputSchema,
    output: VisionRouteResultSchema
  },
  repo_policy_explain: {
    input: PolicyExplainInputSchema,
    output: PolicyExplainResultSchema
  },
  repo_last_write: {
    input: LastWriteInputSchema,
    output: LastWriteResultSchema
  },
  repo_read: {
    input: RepoReadInputSchema,
    output: RepoReadResultSchema
  },
  repo_tree: {
    input: RepoTreeInputSchema,
    output: RepoTreeResultSchema
  },
  repo_search: {
    input: SearchInputSchema,
    output: SearchResponseSchema
  },
  repo_fetch_file: {
    input: FetchFileInputSchema,
    output: FileContentSchema
  },
  repo_read_many: {
    input: ReadManyInputSchema,
    output: ReadManyResultSchema
  },
  repo_git_status: {
    input: GitStatusInputSchema,
    output: GitStatusResultSchema
  },
  repo_git_diff: {
    input: GitDiffInputSchema,
    output: GitDiffResultSchema
  },
  repo_git_review: {
    input: GitReviewInputSchema,
    output: GitReviewResultSchema
  },
  repo_git_stage: {
    input: GitStageInputSchema,
    output: GitStageResultSchema
  },
  repo_git_unstage: {
    input: GitUnstageInputSchema,
    output: GitUnstageResultSchema
  },
  repo_git_restore_paths: {
    input: GitRestorePathsInputSchema,
    output: GitRestorePathsResultSchema
  },
  repo_git_commit: {
    input: GitCommitInputSchema,
    output: GitCommitResultSchema
  },
  repo_write_stage: {
    input: GitStageInputSchema,
    output: GitStageResultSchema
  },
  repo_write_unstage: {
    input: GitUnstageInputSchema,
    output: GitUnstageResultSchema
  },
  repo_write_commit: {
    input: GitCommitInputSchema,
    output: GitCommitResultSchema
  },
  repo_write_stage_commit: {
    input: GitStageCommitInputSchema,
    output: GitStageCommitResultSchema
  },
  repo_write_recover: {
    input: GitRecoverInputSchema,
    output: GitRecoverResultSchema
  },
  repo_cleanup_paths: {
    input: CleanupPathsInputSchema,
    output: CleanupPathsResultSchema
  },
  repo_project_context: {
    input: RepoProjectContextInputSchema,
    output: RepoProjectContextResultSchema
  },
  repo_project_brief: {
    input: ProjectBriefInputSchema,
    output: ProjectBriefResultSchema
  },
  repo_project_memory: {
    input: ProjectMemoryInputSchema,
    output: ProjectMemoryDashboardResultSchema
  },
  repo_task_inventory: {
    input: TaskInventoryInputSchema,
    output: TaskInventoryResultSchema
  },
  repo_decision_memory: {
    input: DecisionLogInputSchema,
    output: DecisionLogResultSchema
  },
  repo_change_plan: {
    input: ChangePlanInputSchema,
    output: ChangePlanResultSchema
  },
  repo_next_action: {
    input: NextActionInputSchema,
    output: NextActionResultSchema
  },
  repo_plan_review: {
    input: PlanReviewInputSchema,
    output: PlanReviewResultSchema
  },
  repo_prepare_codex_task: {
    input: CodexTaskInputSchema,
    output: CodexTaskResultSchema
  },
  repo_write_codex_task: {
    input: CodexTaskWriteInputSchema,
    output: CodexTaskWriteResultSchema
  },
  repo_write_codex_tasks_batch: {
    input: CodexTaskBatchWriteInputSchema,
    output: CodexTaskBatchWriteResultSchema
  },
  repo_codex_appserver_turn: {
    input: CodexAppserverTurnInputSchema,
    output: CodexAppserverTurnResultSchema
  },
  repo_codex_review: {
    input: CodexReviewInputSchema,
    output: CodexReviewResultSchema
  },
  codex_run_and_wait: {
    input: CodexRunAndWaitInputSchema,
    output: CodexRunAndWaitResultSchema
  },
  repo_lab_exec: {
    input: LabExecInputSchema,
    output: LabExecResultSchema
  },
  repo_hermes_intake: {
    input: HermesIntakeInputSchema,
    output: HermesIntakeResultSchema
  },
  repo_town_portal_return: {
    input: TownPortalReturnInputSchema,
    output: TownPortalReturnResultSchema
  },
  repo_write_file: {
    input: WriteFileInputSchema,
    output: WriteFileResultSchema
  },
  repo_write_changes: {
    input: WriteChangesInputSchema,
    output: WriteChangesResultSchema
  },
  repo_write_handoff: {
    input: HandoffInputSchema,
    output: HandoffResultSchema
  }
} as const satisfies Record<ToolName, ToolContract>;
