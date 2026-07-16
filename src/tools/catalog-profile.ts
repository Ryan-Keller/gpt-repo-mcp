import type { ToolName } from "./contracts.js";

export type ToolCatalogProfile = "compact" | "full";

export const COMPACT_TOOL_NAMES = [
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
] as const satisfies readonly ToolName[];

export function normalizeToolCatalogProfile(value: string | undefined): ToolCatalogProfile {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "full" || normalized === "debug" || normalized === "legacy" || normalized === "local") {
    return "full";
  }
  return "compact";
}

export function toolCatalogProfileFromEnv(env: NodeJS.ProcessEnv = process.env): ToolCatalogProfile {
  return normalizeToolCatalogProfile(
    env.GPT_REPO_TOOL_PROFILE ??
    env.BRIDGE_TOOL_PROFILE ??
    env.GPT_REPO_MCP_TOOL_PROFILE
  );
}
