import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HermesKanbanCommandInput, HermesKanbanCommandResult } from "../contracts/hermes-supervision.contract.js";

const execFileAsync = promisify(execFile);
const DEFAULT_WSL_DISTRO = "HermesUbuntu";
const DEFAULT_HERMES_CLI_PATH = "/home/ryan/.local/bin/hermes";
const TASK_ID_PATTERN = /^t_[a-f0-9]{8}$/;
const PROFILE_PATTERN = /^(?:none|[a-z][a-z0-9_-]{0,63})$/;
const IDEMPOTENCY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,159}$/;
const TERMINAL_STATUSES = new Set(["done", "archived"]);

type TaskSnapshot = {
  id: string;
  title: string;
  assignee: string;
  status: string;
};

type CommandRunner = (command: string, args: string[]) => Promise<string>;

export class HermesKanbanCommandService {
  constructor(private readonly options: {
    wslDistro?: string;
    hermesCliPath?: string;
    commandRunner?: CommandRunner;
  } = {}) {}

  async execute(input: HermesKanbanCommandInput): Promise<HermesKanbanCommandResult> {
    const observedAt = new Date().toISOString();
    const distro = this.options.wslDistro ?? process.env.HERMES_WSL_DISTRO ?? DEFAULT_WSL_DISTRO;
    const dryRun = input.dry_run === true;

    if (input.operation === "create_followup") {
      const validation = this.validateCreate(input);
      if (validation) return this.rejected(input, observedAt, validation);
      const summary = `Create one deduplicated follow-up task on ${input.board} assigned to ${input.assignee}.`;
      if (dryRun) return this.dryRun(input, observedAt, summary);
      const output = await this.run(distro, [
        "kanban", "--board", input.board, "create",
        input.title ?? "",
        "--body", input.body ?? "",
        "--assignee", input.assignee ?? "",
        "--workspace", "scratch",
        "--idempotency-key", input.idempotency_key ?? "",
        "--created-by", "chatgpt",
        "--json"
      ]);
      const created = taskFromCreate(output);
      if (!created.id || !TASK_ID_PATTERN.test(created.id)) {
        return this.rejected(input, observedAt, "HERMES_CREATE_RESPONSE_MISSING_TASK_ID");
      }
      return {
        ok: true,
        status: "executed",
        repo_id: input.repo_id,
        board: input.board,
        operation: input.operation,
        task_id: created.id,
        before_status: "not_created",
        after_status: created.status || "created",
        command_summary: summary,
        observed_at: observedAt,
        next_action: "return_to_repo_hermes_watch_and_verify_the_followup_task",
        warnings: []
      };
    }

    const validation = this.validateExistingTask(input);
    if (validation) return this.rejected(input, observedAt, validation);
    const before = await this.show(distro, input.board, input.task_id ?? "");
    if (!before.id) return this.rejected(input, observedAt, "HERMES_TASK_NOT_FOUND");
    if (before.status !== input.expected_status) {
      return this.rejected(input, observedAt, `HERMES_EXPECTED_STATUS_MISMATCH:${before.status}`);
    }
    if (input.operation !== "comment" && input.operation !== "archive" && TERMINAL_STATUSES.has(before.status)) {
      return this.rejected(input, observedAt, `HERMES_TERMINAL_TASK_MUTATION_BLOCKED:${before.status}`);
    }
    if (input.operation === "assign" && before.status === "running") {
      return this.rejected(input, observedAt, "HERMES_RUNNING_TASK_REASSIGN_REQUIRES_RECLAIM");
    }
    if (input.operation === "archive" && ["running", "archived"].includes(before.status)) {
      return this.rejected(input, observedAt, `HERMES_TASK_ARCHIVE_BLOCKED:${before.status}`);
    }

    const summary = commandSummary(input, before);
    if (dryRun) return this.dryRun(input, observedAt, summary, before);
    await this.mutate(distro, input);
    const after = await this.show(distro, input.board, input.task_id ?? "");
    return {
      ok: true,
      status: "executed",
      repo_id: input.repo_id,
      board: input.board,
      operation: input.operation,
      task_id: before.id,
      before_status: before.status,
      after_status: after.status || before.status,
      command_summary: summary,
      observed_at: observedAt,
      next_action: "return_to_repo_hermes_watch_and_verify_the_task_event",
      warnings: []
    };
  }

  private validateCreate(input: HermesKanbanCommandInput): string {
    if (!input.title?.trim()) return "HERMES_FOLLOWUP_TITLE_REQUIRED";
    if (!input.body?.trim()) return "HERMES_FOLLOWUP_BODY_REQUIRED";
    if (!input.assignee || !PROFILE_PATTERN.test(input.assignee)) return "HERMES_VALID_ASSIGNEE_REQUIRED";
    if (!input.idempotency_key || !IDEMPOTENCY_PATTERN.test(input.idempotency_key)) return "HERMES_VALID_IDEMPOTENCY_KEY_REQUIRED";
    return "";
  }

  private validateExistingTask(input: HermesKanbanCommandInput): string {
    if (!input.task_id || !TASK_ID_PATTERN.test(input.task_id)) return "HERMES_VALID_TASK_ID_REQUIRED";
    if (!input.expected_status?.trim()) return "HERMES_EXPECTED_STATUS_REQUIRED";
    if (["comment", "block", "schedule", "unblock", "promote", "archive"].includes(input.operation) && !input.instruction?.trim()) {
      return "HERMES_INSTRUCTION_REQUIRED";
    }
    if (input.operation === "assign" && (!input.assignee || !PROFILE_PATTERN.test(input.assignee))) {
      return "HERMES_VALID_ASSIGNEE_REQUIRED";
    }
    if (input.operation === "block" && !input.block_kind) return "HERMES_BLOCK_KIND_REQUIRED";
    return "";
  }

  private async mutate(distro: string, input: HermesKanbanCommandInput): Promise<void> {
    const taskId = input.task_id ?? "";
    const instruction = input.instruction ?? "";
    switch (input.operation) {
      case "comment":
        await this.run(distro, ["kanban", "--board", input.board, "comment", "--author", "chatgpt", "--max-len", "6000", taskId, instruction]);
        return;
      case "assign":
        await this.run(distro, ["kanban", "--board", input.board, "assign", taskId, input.assignee ?? ""]);
        return;
      case "block":
        await this.run(distro, ["kanban", "--board", input.board, "block", "--kind", input.block_kind ?? "", taskId, instruction]);
        return;
      case "schedule":
        await this.run(distro, ["kanban", "--board", input.board, "schedule", taskId, instruction]);
        return;
      case "unblock":
        await this.run(distro, ["kanban", "--board", input.board, "unblock", "--reason", instruction, taskId]);
        return;
      case "promote":
        await this.run(distro, ["kanban", "--board", input.board, "promote", taskId, instruction, "--json"]);
        return;
      case "archive":
        await this.run(distro, ["kanban", "--board", input.board, "comment", "--author", "chatgpt", "--max-len", "6000", taskId, `Archive reason: ${instruction}`]);
        await this.run(distro, ["kanban", "--board", input.board, "archive", taskId]);
        return;
      default:
        throw new Error(`Unsupported guarded Hermes operation: ${input.operation}`);
    }
  }

  private async show(distro: string, board: string, taskId: string): Promise<TaskSnapshot> {
    const output = await this.run(distro, ["kanban", "--board", board, "show", taskId, "--json"]);
    return taskFromShow(output);
  }

  private async run(distro: string, hermesArgs: string[]): Promise<string> {
    const runner = this.options.commandRunner ?? defaultCommandRunner;
    const cliPath = this.options.hermesCliPath ?? process.env.HERMES_CLI_PATH ?? DEFAULT_HERMES_CLI_PATH;
    return runner("wsl.exe", ["-d", distro, "--", cliPath, ...hermesArgs]);
  }

  private dryRun(
    input: HermesKanbanCommandInput,
    observedAt: string,
    summary: string,
    before: TaskSnapshot = { id: "", title: "", assignee: "", status: "not_created" }
  ): HermesKanbanCommandResult {
    return {
      ok: true,
      status: "dry_run",
      repo_id: input.repo_id,
      board: input.board,
      operation: input.operation,
      task_id: before.id || input.task_id || "",
      before_status: before.status,
      after_status: before.status,
      command_summary: summary,
      observed_at: observedAt,
      next_action: "request_explicit_user_approval_then_repeat_with_dry_run_false",
      warnings: ["DRY_RUN_ONLY:NO_HERMES_MUTATION_PERFORMED"]
    };
  }

  private rejected(input: HermesKanbanCommandInput, observedAt: string, warning: string): HermesKanbanCommandResult {
    return {
      ok: false,
      status: "rejected",
      repo_id: input.repo_id,
      board: input.board,
      operation: input.operation,
      task_id: input.task_id ?? "",
      before_status: input.expected_status ?? "",
      after_status: input.expected_status ?? "",
      command_summary: "Guarded Hermes Kanban command rejected before mutation.",
      observed_at: observedAt,
      next_action: "refresh_repo_hermes_watch_evidence_and_retry_only_with_current_exact_fields",
      warnings: [warning]
    };
  }
}

async function defaultCommandRunner(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 512 * 1024
  });
  return stdout;
}

function taskFromShow(text: string): TaskSnapshot {
  const parsed = parseRecord(text);
  const task = record(parsed.task);
  return taskSnapshot(task);
}

function taskFromCreate(text: string): TaskSnapshot {
  const parsed = parseRecord(text);
  return taskSnapshot(Object.keys(record(parsed.task)).length > 0 ? record(parsed.task) : parsed);
}

function taskSnapshot(task: Record<string, unknown>): TaskSnapshot {
  return {
    id: stringValue(task.id),
    title: stringValue(task.title),
    assignee: stringValue(task.assignee),
    status: stringValue(task.status)
  };
}

function parseRecord(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  return record(parsed);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function commandSummary(input: HermesKanbanCommandInput, task: TaskSnapshot): string {
  switch (input.operation) {
    case "comment": return `Append a ChatGPT comment to ${task.id}.`;
    case "assign": return `Assign ${task.id} to ${input.assignee}.`;
    case "block": return `Block ${task.id} as ${input.block_kind}.`;
    case "schedule": return `Move ${task.id} to scheduled.`;
    case "unblock": return `Unblock ${task.id} using Hermes recovery semantics.`;
    case "promote": return `Promote ${task.id} without forcing unresolved dependencies.`;
    case "archive": return `Archive ${task.id} while retaining its Hermes history and project artifacts.`;
    default: return `Run guarded Hermes operation ${input.operation} for ${task.id}.`;
  }
}
