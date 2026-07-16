import type { ToolCatalogProfile } from "./tools/catalog-profile.js";

const BASE_INSTRUCTIONS = [
  "GPT Repo MCP is a read-mostly local repository MCP app. Read tools inspect approved repositories. Mutating tools are disabled by default and require repo-local config opt-in.",
  "The default tool profile is compact for ChatGPT. Use repo_list_roots for approved repos and bridge/session evidence, repo_bridge_concierge for intent routing, repo_runner_status for runner or Hermes Kanban/off-thread supervision status, repo_hermes_intake for bounded Hermes packet handoff, and repo_hermes_intervene for an explicitly approved bounded checkpoint correction.",
  "Compact mutating tools include repo_hermes_intake, repo_hermes_intervene, repo_write_changes, repo_write_handoff, repo_write_codex_task, repo_write_stage_commit, and repo_write_recover. They require explicit user approval for actual mutation; do not push, pull, reset, checkout, switch, rebase, merge, stash, clean, force, or delete branches, and do not run shell commands.",
  "For current-change shipping, recovery, or commit prep, repo_git_review is the workflow hub. Prefer composite workflow tools: repo_write_stage_commit for reviewed happy-path local commits and repo_write_recover for reviewed recovery, unstage, restore, or cleanup. Use repo_git_status and repo_git_diff for read-only git evidence.",
  "Direct implementation with repo_write_changes is the default when the user asks ChatGPT to fix, implement, update, or edit repository files. Use repo_write_codex_task only when the user explicitly asks for a Codex prompt, Codex task, delegation to Codex, or a queued Codex run. Use repo_codex_review after Codex has finished.",
  "For onboarding, daily planning, task inventory, decision memory, implementation planning, and next-action advice, use repo_project_context with the matching mode. Do not read the whole repository to understand a project.",
  "For code drilldown, use repo_read with mode=tree for structure, mode=search for locating relevant code, mode=file for specific files, and mode=many only for bounded known sets. Do not read an entire repository.",
  "When the user asks for a local-only ChatGPT handoff or resume note, use repo_write_handoff. Handoffs are private working context and normally should not be committed.",
  "Dry-run is optional preview, not a required ritual. Use dry_run when the user asks for preview, risk is unclear, testing a new tool, or the state is unusual. Omit optional reason by default unless it adds meaningful audit context.",
  "For continuity after an interruption or new turn, use repo_last_write for safe receipt metadata, then repo_git_review for current git truth, then repo_write_stage_commit or repo_write_recover from review payloads.",
  "All paths are repo-relative POSIX paths and all repository access is scoped by repo_id. Default excludes and secret blocking are enforced by the server; do not ask for absolute paths or secrets.",
  "Nested repositories and submodules are separate trust boundaries and are not read unless registered as their own repo_id."
] as const;

const FULL_PROFILE_INSTRUCTIONS = [
  "Full tool profile is for local debug, legacy connector sessions, and compatibility testing. It additionally exposes granular repository read/project tools, low-level git aliases, granular staging and commit tools, direct live-tail, batch Codex queueing, synchronous Codex launch, guarded lab execution, Town Portal return, and single-file write compatibility.",
  "Prefer compact-profile workflows even in full mode unless the user explicitly asks for a legacy, granular, lab, or debug route."
] as const;

export function getServerInstructions(profile: ToolCatalogProfile = "compact"): string {
  return [
    ...BASE_INSTRUCTIONS,
    ...(profile === "full" ? FULL_PROFILE_INSTRUCTIONS : [])
  ].join(" ");
}

export const SERVER_INSTRUCTIONS = getServerInstructions("compact");
export const FULL_SERVER_INSTRUCTIONS = getServerInstructions("full");
