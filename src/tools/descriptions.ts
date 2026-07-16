export const descriptions = {
  repo_list_roots:
    "Use this when the user asks which approved repositories are available, or when ChatGPT needs a read-only hub view of bridge capability status. Pass capability_id=\"hermes_kanban\" with optional hermes_board to inspect Hermes Kanban board status without adding a new tool name. Does not read repository file contents.",
  repo_bridge_concierge:
    "Use this when the user asks about a project, capability, goal, problem, latest progress, overnight changes, or what to work on next and should not need to know files, artifacts, run IDs, or storage paths. Resolves the human intention to a destination packet with identity, status, latest truth, next action, known/inferred/unknown, and evidence. Read-only; never launches Codex, mutates files, stages, commits, pushes, deletes, clears locks, runs shell commands, or hides evidence.",
  agent_runner_status:
    "Use this when the user asks whether the Shared Agent Bridge Codex runner is alive, pending, stale, locked, blocked, or completed. Compatibility alias for repo_runner_status; returns the same status. Defaults to a compact summary; use detail=\"full\" only when detailed queue, event, result, or live-tail evidence is needed.",
  repo_runner_status:
    "Use this when the user asks to show runner status, check whether Codex or Hermes work is actually progressing, inspect an active run, monitor live-tail progress, verify Shared Agent Bridge worker health, or expand one read-only capability surface such as town_portal or hermes_kanban through capability_id. For Hermes supervision, pass optional hermes_board and/or hermes_transaction plus a previous hermes_cursor to receive compact transaction checkpoints, process-log tails, receipts, and acceptance state. Defaults to detail=\"summary\"; use detail=\"full\" only for detailed evidence. Supports bounded bridge-side polling with poll_count and poll_interval_seconds. Never launches work, mutates files, overrides acceptance, or runs arbitrary shell commands.",
  repo_run_live_tail:
    "Use this when the user asks what an active or recent Shared Agent Bridge Codex run is doing. Reads .chatgpt/codex-runs/<run_id>/events.jsonl and safe log tails only; never launches Codex, mutates files, stages, commits, pushes, deletes, clears locks, or runs shell commands.",
  repo_connector_whoami:
    "Use this when diagnosing ChatGPT connector identity, session termination, auth header behavior, Cloudflare Access behavior, tokenized route usage, or whether discovery and tool calls are using the same MCP route. Returns redacted request facts only; never exposes tokens, emails, prompts, repo contents, local paths, or secrets.",
  repo_vision_routes:
    "Use this when the user asks whether local Google/Gemini/Gemma/Ollama vision analysis is actually configured. Read-only detector that reports observed routes and typed missing capabilities without printing secrets, launching Codex, staging, committing, pushing, deleting, or mutating files.",
  repo_policy_explain:
    "Use this when a read, write, or cleanup policy question is blocked or the user asks what ChatGPT can access in a repo. Explains effective read/write/cleanup policy, local git operation toggles, matched globs, block reasons, and next steps without reading or mutating files.",
  repo_last_write:
    "Use this when the user asks what the last write operation changed or how to continue review/recovery after a previous write. Reads safe local receipt metadata only and never mutates files or git.",
  repo_read:
    "Use this when ChatGPT needs compact repository reading. Select mode=tree to inspect structure, mode=search to locate code, mode=file to read one specific file or line range, and mode=many for a bounded explicit path/glob set. Read-only; never mutates files, stages, commits, pushes, deletes, or runs shell commands.",
  repo_tree:
    "Use this when the user asks to inspect repository structure or locate likely files by directory. Do not use this when the user asks to read file contents.",
  repo_search:
    "Use this when the user asks to find code, inspect usages, perform a bughunt, or locate relevant files before reading them. Prefer this before repo_read_many.",
  repo_fetch_file:
    "Use this when the user names a specific file or after repo_tree/repo_search identifies a relevant file. Supports line ranges. Do not use for broad repository review.",
  repo_read_many:
    "Use this when the user asks to read a bounded set of explicit files or glob-matched files. Do not use this to read an entire repository.",
  repo_git_status:
    "Use this when the user asks for git status, branch, dirty files, or changed file counts. Do not use this to inspect file contents.",
  repo_git_diff:
    "Use this when the user asks to review changes or inspect a git diff. Default first call should pass only repo_id. Do not include staged, unstaged, paths, max_bytes, or context_lines on the first pass. Use optional filters only after the default diff is truncated, too broad, or the user asks for a specific comparison.",
  repo_git_review:
    "Use this when the user asks to review current git changes, recover bad write-tool edits, clean up generated artifacts, prepare staging, or plan a local commit without mutating anything. Workflow hub that returns status, diff summary, warnings, and ready-to-run composite payloads for repo_write_stage_commit and repo_write_recover plus low-level fallback payloads.",
  repo_git_stage:
    "Use this when compatibility with the git-prefixed staging alias is needed; prefer repo_write_stage for ChatGPT workflows. Stages explicit repo-relative paths only, requires user approval and expected HEAD, and never runs shell commands.",
  repo_git_unstage:
    "Use this when compatibility with the git-prefixed unstaging alias is needed; prefer repo_write_unstage for ChatGPT workflows. Unstages explicit repo-relative paths only, requires user approval and expected HEAD, and never runs shell commands.",
  repo_git_restore_paths:
    "Use this when the user explicitly asks to recover bad unstaged worktree changes for reviewed explicit repo-relative paths. Runs only git restore -- <paths>, requires expected HEAD, does not unstage, stage, commit, reset, checkout, or run shell commands.",
  repo_git_commit:
    "Use this when compatibility with the git-prefixed commit alias is needed; prefer repo_write_commit for ChatGPT workflows. Creates a local-only commit from exact staged paths, requires user approval and expected HEAD, does not push, and never runs shell commands.",
  repo_write_stage:
    "Use this when the user explicitly asks to stage reviewed repo-relative paths separately or granular control is needed; prefer repo_write_stage_commit after repo_git_review for normal reviewed commits. Requires user approval, expected HEAD, explicit paths, and never runs shell commands.",
  repo_write_unstage:
    "Use this when the user explicitly asks to unstage reviewed repo-relative paths separately or granular recovery control is needed; prefer repo_write_recover after repo_git_review for normal reviewed recovery. Requires user approval, expected HEAD, explicit paths, and never runs shell commands.",
  repo_write_commit:
    "Use this when the user explicitly asks to create a local-only commit from already staged reviewed paths, or staged-only flow requires a commit without staging; prefer repo_write_stage_commit after repo_git_review for normal reviewed commits. Requires user approval, exact staged path verification, expected HEAD, does not push, and never runs shell commands.",
  repo_write_stage_commit:
    "Use this when the user has reviewed repo_git_review output and explicitly approves staging and committing exact repo-relative paths in one local-only operation. Requires expected HEAD, explicit paths, exact staged path verification, does not push, and never runs shell commands.",
  repo_write_recover:
    "Use this when the user has reviewed repo_git_review output and explicitly approves recovering exact repo-relative paths in one operation. Can unstage, restore tracked worktree paths, and clean configured generated artifacts; requires expected HEAD, explicit paths, does not reset, checkout, stash, clean, commit, push, or run shell commands.",
  repo_cleanup_paths:
    "Use this when the user explicitly asks to delete generated repo-local artifacts or local ChatGPT artifacts separately, or granular cleanup control is needed; prefer repo_write_recover after repo_git_review for normal reviewed recovery. Requires user approval, explicit paths, refuses tracked files, and never runs shell commands or git clean.",
  repo_project_context:
    "Use this when ChatGPT needs compact project understanding and planning. Select mode=brief, memory, tasks, decisions, plan, or next_action instead of carrying separate planning tools in the default surface. Read-only; never mutates files, stages, commits, pushes, deletes, launches Codex, or runs shell commands.",
  repo_project_brief:
    "Use this when the user asks to understand, onboard into, plan work for, summarize, or start a daily planning session for an approved repository. Prefer this as the first planning tool because it returns bounded project signals without reading the whole repo.",
  repo_project_memory:
    "Use this when the user asks for persistent project memory, all projects, active roadmap, paused ideas, research watchlist, latest results, dream report inputs, or suggested next moves. Read-only dashboard over .chatgpt/project-memory; never mutates files, stages, commits, pushes, deletes, clears locks, runs shell commands, or performs internet research.",
  repo_portfolio_report:
    "Use this when the user wants the phone-first Operations Console across active projects, roadmap slices, research topics, recent evidence, artifacts, or paused experiments. Returns project workspaces, synchronized seen/playbook state, typed artifact cards, copyable fresh-thread re-entry packets, evidence-derived recommendations, active work, handled history, and action receipts. Handled actions are suppressed until restored or a snooze expires.",
  repo_portfolio_action_command:
    "Use this when the user selects an Operations Console lifecycle change or asks to synchronize phone-console state. By default it records only the repo-local action ledger. A single route action may include an explicit execution request with an approved target repo, bounded objective, narrow allowed paths, proof boundary, 90-95 satisfaction gate, and operator consent; that guarded path invokes the installed Hermes off-thread launcher and returns goal, transaction, board, task, and watch identities. sync_console does not execute work. Stop does not terminate Hermes; use the guarded Hermes cancel tool for a verified active transaction.",
  repo_task_inventory:
    "Use this when the user asks to find repo-local TODOs, FIXMEs, HACKs, roadmap notes, markdown checklist items, backlog candidates, or next tasks. Returns file and line grounded backlog signals for planning.",
  repo_decision_memory:
    "Use this when the user asks about project memory, architecture decisions, conventions, patterns, rationale, or why the project is structured a certain way. Returns bounded evidence-grounded decisions, conventions, and gaps from repo documentation and package metadata.",
  repo_change_plan:
    "Use this when the user asks how to implement, refactor, debug, fix, or add a feature without writing files. Returns an evidence-grounded implementation plan, likely files, risks, tests, and open questions.",
  repo_next_action:
    "Use this when the user asks what to do next, what to prioritize, whether work is ready to ship, what to clean up, or how to choose focused solo-dev work. Returns advisory next actions from repo status, project brief, and task inventory.",
  repo_plan_review:
    "Use this when the user asks for broad or ambiguous repository review. It estimates scope and suggests whether to ask a clarifying question before reading many files; for onboarding or daily planning prefer repo_project_brief first.",
  repo_prepare_codex_task:
    "Use this when the user explicitly asks for a Codex prompt, Codex task, or delegation to Codex and wants the prompt returned in chat for review/copying. Does not write files or implement the change.",
  repo_write_codex_task:
    "Use this when the user explicitly asks to write a Codex prompt/task/run for Codex to execute later. For project repos, writes the task into the shared-agent-bridge central runner queue while preserving the target repo_id in run.json; writes only .chatgpt/codex-runs/<run_id>/PROMPT.md and run.json through repo write policy; does not implement, stage, commit, push, or run Codex.",
  repo_write_codex_tasks_batch:
    "Use this when the user explicitly asks to write a bounded batch of small Codex prompt/task/run seeds for Codex to execute later. For project repos, writes accepted seeds into the shared-agent-bridge central runner queue while preserving the target repo_id in each run.json. Validates one to five seeds, rejects duplicate run_ids or equivalent titles before writing, writes one PROMPT.md and run.json per accepted seed through repo write policy, and does not implement, stage, commit, push, or run Codex.",
  repo_codex_appserver_turn:
    "Use this when the user explicitly asks ChatGPT to send or dry-run a bounded turn through the loopback-only Codex app-server direct lane. Defaults to dry_run, rejects non-loopback WebSocket URLs, returns redacted JSON-RPC envelope receipts, models bootstrap-once then direct-send behavior, and never exposes secrets, broad shell access, git operations, public sockets, or non-loopback targets.",
  repo_codex_review:
    "Use this when Codex has finished or the user asks to review a Codex run. For project repos, reads RESULT.md from the shared-agent-bridge central runner queue and reviews the git diff in the target repo_id without mutating files or git.",
  codex_run_and_wait:
    "Use this when the user asks ChatGPT to synchronously launch exactly one existing Codex run and wait for its RESULT.md. For project repos, uses the shared-agent-bridge central runner queue while preserving the target repo_id. Uses a lock file, can classify and explicitly recover stale locks, runs npx --no-install @openai/codex exec - with the prompt-path instruction on stdin, returns result text and log tails, and never stages, commits, pushes, deletes, starts multiple jobs, or stores secrets.",
  repo_lab_exec:
    "Use this when the user explicitly asks to run an approved Shared Agent Bridge lab file. Executes only node with a repo-relative .mjs/.js file under shared/experiments, uses no shell, rejects unsafe commands before spawning, enforces timeout and output caps, and never runs git, Codex, npm install, network tools, deletes, background processes, stages, commits, pushes, or clears locks.",
  repo_hermes_intake:
    "Use this when the user explicitly asks ChatGPT to send a large idea, roadmap, product direction, research agenda, or multi-profile work plan directly to Hermes Orchestrator. Bounded packet-write lane: writes only shared/hermes-intake/<job_id>/manifest.json and INTAKE.md, optionally submits that manifest through the guarded local Hermes CLI, reads RESULT.md when available, and never stores secrets, stages, commits, pushes, deletes, clears locks, changes remotes, restarts services, or exposes private connector URLs. Use repo_runner_status with capability_id=\"hermes_kanban\" to inspect board status afterward.",
  repo_hermes_intervene:
    "Use this when the user explicitly approves steering an existing active Hermes off-thread transaction. Appends one bounded correction, constraint, verification request, priority change, pause request, or resume request to that transaction's CHECKPOINTS.md and writes an append-only intervention receipt. It does not run shell commands, edit the target repository, create another transaction, kill or start processes, override acceptance, reconcile completion, stage, commit, push, delete, or expose secrets. Afterward return to repo_runner_status with capability_id=\"hermes_kanban\" and the same hermes_transaction.",
  repo_hermes_cancel:
    "Use this when the user explicitly approves stopping one exact active Hermes off-thread transaction. Derives the transaction path from its validated id, invokes the guarded Hermes Cancel command, verifies the process tree belongs to that transaction before termination, parks unfinished Kanban work, and returns the cancellation receipt. Supports dry_run. It does not accept arbitrary paths or commands.",
  repo_hermes_kanban_command:
    "Use this when the user explicitly approves one guarded Hermes Kanban change after ChatGPT has refreshed the exact task and status. Supports comment, assign, block, schedule, unblock, non-forced promote, reason-recorded archive, and deduplicated follow-up creation. Archive preserves Hermes history and project artifacts; permanent deletion is unavailable. Requires optimistic expected_status protection and supports dry_run. It cannot complete, purge, claim, reclaim, force dependencies, control workers, edit target repositories, override acceptance, stage, commit, push, or run arbitrary shell commands. Afterward return to repo_hermes_watch and verify the resulting task event.",
  repo_hermes_watch:
    "Use this when the user asks ChatGPT to watch, supervise, live-tail, or stay with Hermes Kanban or one Hermes off-thread transaction. This is the dedicated read-only resident watch: it polls Hermes-specific durable evidence server-side for up to 55 seconds, returns immediately on new evidence or a terminal state, and otherwise returns a factual heartbeat at the deadline. For connector sessions that predate repo_portfolio_report, hermes_board=\"portfolio-console\" opens the read-only cross-project action console through this stable tool. Continue normal watches with next_cursor; do not search unrelated sources. Never launches work, mutates files, overrides acceptance, stages, commits, pushes, deletes, or runs arbitrary shell commands.",
  repo_town_portal_return:
    "Use this when the user explicitly asks to exercise the lab-scoped Town Portal advisory return route. Validates one supplied portal and one display-only payload before a narrow shared/status/town-portal-lab adapter handoff; requires lab_mode, consumes terminal handles in process, and never launches agents, queues Codex, mutates runner state, clears locks, stages, commits, pushes, deletes, or runs shell commands.",
  repo_write_file:
    "Use this when the user explicitly asks to write or precisely edit one allowed repository file. Primary low-friction single-file writer/editor for docs, notes, prompts, and focused code edits; requires user approval, repo opt-in, and never runs shell, git, or Codex.",
  repo_write_changes:
    "Use this when the user explicitly asks to apply a cohesive multi-file edit pack to allowed repository files. Primary low-friction multi-file writer/editor for full-file writes and exact-match edits; requires user approval, repo opt-in, and never runs shell, git, stage, commit, or restore.",
  repo_write_handoff:
    "Use this when the user asks for a local-only ChatGPT handoff: skapa handoff, create handoff, skriv handoff, session handoff, resume note, fortsättningsanteckning, ny chatt context, or överlämning till nästa chatt. Creates .chatgpt/handoffs/*.local.md and updates current.local.md; never stages, commits, pushes, resets, checks out, or runs shell commands."
} as const;
