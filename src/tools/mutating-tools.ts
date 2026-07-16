import type { ToolName } from "./contracts.js";

export const MUTATING_TOOL_NAMES = [
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
] as const satisfies readonly ToolName[];

const MUTATING_TOOL_NAME_SET = new Set<ToolName>(MUTATING_TOOL_NAMES);

export function isMutatingToolName(name: ToolName | string): name is typeof MUTATING_TOOL_NAMES[number] {
  return MUTATING_TOOL_NAME_SET.has(name as ToolName);
}
