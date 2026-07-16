import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HermesSupervisionService, type HermesSupervisionStatus } from "./hermes-supervision-service.js";

const execFileAsync = promisify(execFile);
const DEFAULT_WSL_DISTRO = "HermesUbuntu";
const DEFAULT_BOARDS_ROOT = "/home/ryan/.hermes/kanban/boards";
const DEFAULT_RECENT_BOARD_COUNT = 5;
const DEFAULT_TASK_COUNT = 8;
const BOARD_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export type HermesKanbanTaskSummary = {
  id: string;
  title: string;
  assignee: string;
  status: string;
  priority: number | null;
  created_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  workspace_path: string;
  result_present: boolean;
  result_summary: string;
};

export type HermesKanbanBoardSummary = {
  board: string;
  board_path: string;
  by_status: Record<string, number>;
  by_assignee: Record<string, Record<string, number>>;
  oldest_ready_age_seconds: number | null;
  task_count: number;
  tasks: HermesKanbanTaskSummary[];
  artifacts_advertised: string[];
  artifact_caveat: string;
};

export type HermesKanbanStatus = {
  state: "available" | "unavailable" | "blocked" | "unknown";
  current_route: "repo_runner_status.capability_summary.hermes_kanban";
  requested_board: string;
  wsl_distro: string;
  boards_root: string;
  board_count: number;
  boards: HermesKanbanBoardSummary[];
  supervision: HermesSupervisionStatus;
  evidence: string[];
  warnings: string[];
  safe_operations: string[];
  blocked_operations: string[];
  suggested_next_action: string;
};

export type HermesKanbanStatusInput = {
  board?: string;
  transaction?: string;
  cursor?: string;
  max_boards?: number;
  max_tasks_per_board?: number;
  max_supervision_events?: number;
  skip_supervision?: boolean;
};

export class HermesKanbanStatusService {
  constructor(
    private readonly options: {
      wslDistro?: string;
      boardsRoot?: string;
      commandRunner?: CommandRunner;
      supervisionService?: HermesSupervisionService;
    } = {}
  ) {}

  async status(input: HermesKanbanStatusInput = {}): Promise<HermesKanbanStatus> {
    const distro = this.options.wslDistro ?? process.env.HERMES_WSL_DISTRO ?? DEFAULT_WSL_DISTRO;
    const boardsRoot = this.options.boardsRoot ?? process.env.HERMES_KANBAN_BOARDS_ROOT ?? DEFAULT_BOARDS_ROOT;
    const requestedBoard = normalizeBoard(input.board);
    const supervisionService = this.options.supervisionService ?? new HermesSupervisionService();
    const supervision = input.skip_supervision
      ? emptySupervisionStatus()
      : await supervisionService.status({
          transaction: input.transaction,
          board: requestedBoard || undefined,
          cursor: input.cursor,
          maxEvents: input.max_supervision_events
        });
    if (input.board && !requestedBoard) {
      return blockedStatus({
        distro,
        boardsRoot,
        requestedBoard: input.board,
        warning: "HERMES_KANBAN_INVALID_BOARD_SLUG",
        supervision
      });
    }

    try {
      const transactionBoard = normalizeBoard(supervision.transactions[0]?.board);
      const focusedBoard = requestedBoard || transactionBoard;
      const boardNames = focusedBoard
        ? [focusedBoard]
        : await this.listRecentBoards(distro, boardsRoot, input.max_boards ?? DEFAULT_RECENT_BOARD_COUNT);
      if (boardNames.length === 0) {
        return {
          ...baseStatus(distro, boardsRoot, requestedBoard),
          supervision,
          state: "unavailable",
          evidence: [`No Hermes Kanban boards found under ${boardsRoot}.`],
          warnings: [],
          suggested_next_action: "submit_or_select_a_hermes_board"
        };
      }

      const boards: HermesKanbanBoardSummary[] = [];
      const warnings: string[] = [];
      for (const board of boardNames) {
        const summary = await this.readBoard(distro, boardsRoot, board, input.max_tasks_per_board ?? DEFAULT_TASK_COUNT);
        if (summary) {
          boards.push(summary);
        } else {
          warnings.push(`HERMES_KANBAN_BOARD_READ_FAILED:${board}`);
        }
      }

      return {
        ...baseStatus(distro, boardsRoot, requestedBoard),
        state: boards.length > 0 ? "available" : "blocked",
        board_count: boards.length,
        boards,
        supervision,
        evidence: boards.length > 0
          ? [`Read ${boards.length} Hermes Kanban board(s) through the local Hermes CLI.`]
          : ["Hermes CLI was reachable but no requested board status could be read."],
        warnings,
        suggested_next_action: boards.some((board) => hasOpenWork(board))
          ? "report_open_hermes_tasks_and_wait_or_choose_followup"
          : "report_done_state_and_review_bridge_artifacts"
      };
    } catch (error) {
      return {
        ...baseStatus(distro, boardsRoot, requestedBoard),
        supervision,
        state: "blocked",
        evidence: ["Hermes Kanban readback failed; off-thread transaction evidence was inspected independently."],
        warnings: [formatCommandError(error)],
        suggested_next_action: supervision.state === "available"
          ? "report_transaction_evidence_and_verify_HermesUbuntu_kanban_readback_separately"
          : "verify_HermesUbuntu_wsl_and_hermes_cli_then_retry"
      };
    }
  }

  private async listRecentBoards(distro: string, boardsRoot: string, maxBoards: number): Promise<string[]> {
    const output = await this.runWsl(distro, [
      "find",
      boardsRoot,
      "-maxdepth",
      "1",
      "-mindepth",
      "1",
      "-type",
      "d",
      "-printf",
      "%f\t%T@\n"
    ]);
    return output
      .split(/\r?\n/)
      .map((line) => {
        const [name = "", mtime = "0"] = line.split("\t");
        return { name: normalizeBoard(name), mtime: Number.parseFloat(mtime) || 0 };
      })
      .filter((item): item is { name: string; mtime: number } => Boolean(item.name))
      .sort((left, right) => right.mtime - left.mtime)
      .slice(0, Math.max(1, Math.min(maxBoards, 20)))
      .map((item) => item.name);
  }

  private async readBoard(
    distro: string,
    boardsRoot: string,
    board: string,
    maxTasks: number
  ): Promise<HermesKanbanBoardSummary | undefined> {
    const [statsText, listText] = await Promise.all([
      this.runHermes(distro, board, "stats"),
      this.runHermes(distro, board, "list")
    ]);
    const stats = parseJsonRecord(statsText);
    const tasks = parseJsonArray(listText);
    return {
      board,
      board_path: `${boardsRoot}/${board}`,
      by_status: numberRecord(stats.by_status),
      by_assignee: nestedNumberRecord(stats.by_assignee),
      oldest_ready_age_seconds: nullableNumber(stats.oldest_ready_age_seconds),
      task_count: tasks.length,
      tasks: tasks
        .slice(0, Math.max(1, Math.min(maxTasks, 50)))
        .map(summarizeTask),
      artifacts_advertised: advertisedArtifacts(tasks),
      artifact_caveat: "Hermes worker scratch artifacts can be absent even when Kanban task records/logs preserve the result; use bridge artifacts under shared/hermes-intake/<job_id>/artifacts when present."
    };
  }

  private async runWsl(distro: string, args: string[]): Promise<string> {
    const runner = this.options.commandRunner ?? defaultCommandRunner;
    return runner("wsl.exe", ["-d", distro, "--", ...args]);
  }

  private async runHermes(distro: string, board: string, subcommand: "stats" | "list"): Promise<string> {
    const command = `hermes kanban --board ${board} ${subcommand} --json`;
    return this.runWsl(distro, ["bash", "-lc", command]);
  }
}

function emptySupervisionStatus(): HermesSupervisionStatus {
  return {
    state: "unavailable",
    requested_transaction: "",
    transaction_root: "",
    transaction_count: 0,
    transactions: [],
    evidence: ["Transaction supervision was not requested for this board-only observation."],
    warnings: [],
    safe_operations: ["observe_board"],
    blocked_operations: [],
    suggested_next_action: "continue_board_observation"
  };
}

type CommandRunner = (command: string, args: string[]) => Promise<string>;

async function defaultCommandRunner(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 512 * 1024
  });
  return stdout;
}

function baseStatus(distro: string, boardsRoot: string, requestedBoard: string): Omit<HermesKanbanStatus, "state" | "evidence" | "warnings" | "suggested_next_action"> {
  return {
    current_route: "repo_runner_status.capability_summary.hermes_kanban",
    requested_board: requestedBoard,
    wsl_distro: distro,
    boards_root: boardsRoot,
    board_count: 0,
    boards: [],
    supervision: {
      state: "unavailable",
      requested_transaction: "",
      transaction_root: "",
      transaction_count: 0,
      transactions: [],
      evidence: [],
      warnings: [],
      safe_operations: [],
      blocked_operations: [],
      suggested_next_action: "request_a_transaction_or_board"
    },
    safe_operations: ["observe_boards", "read_task_status", "read_latest_task_results", "read_transaction_live_tail", "report_current_status"],
    blocked_operations: ["create_task", "claim_task", "complete_task", "mutate_repo", "stage_commit_push", "delete_artifacts", "restart_services", "acceptance_override"],
  };
}

function blockedStatus(input: {
  distro: string;
  boardsRoot: string;
  requestedBoard: string;
  warning: string;
  supervision: HermesSupervisionStatus;
}): HermesKanbanStatus {
  return {
    ...baseStatus(input.distro, input.boardsRoot, input.requestedBoard),
    supervision: input.supervision,
    state: "blocked",
    evidence: ["Requested board id failed the Hermes board slug guard."],
    warnings: [input.warning],
    suggested_next_action: "retry_with_lowercase_dash_board_slug"
  };
}

function normalizeBoard(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return BOARD_SLUG_PATTERN.test(trimmed) ? trimmed : "";
}

function parseJsonRecord(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function parseJsonArray(text: string): Record<string, unknown>[] {
  const parsed = JSON.parse(text) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}

function summarizeTask(task: Record<string, unknown>): HermesKanbanTaskSummary {
  const result = typeof task.result === "string" ? task.result : "";
  return {
    id: compact(task.id, 80),
    title: compact(task.title, 180),
    assignee: compact(task.assignee, 80),
    status: compact(task.status, 40),
    priority: nullableNumber(task.priority),
    created_at: nullableNumber(task.created_at),
    started_at: nullableNumber(task.started_at),
    completed_at: nullableNumber(task.completed_at),
    workspace_path: compact(task.workspace_path, 260),
    result_present: result.length > 0,
    result_summary: compact(result, 400)
  };
}

function advertisedArtifacts(tasks: Record<string, unknown>[]): string[] {
  const artifacts = new Set<string>();
  for (const task of tasks) {
    const payloads = Array.isArray(task.events) ? task.events : [];
    for (const event of payloads) {
      const record = typeof event === "object" && event !== null ? event as Record<string, unknown> : {};
      const payload = typeof record.payload === "object" && record.payload !== null ? record.payload as Record<string, unknown> : {};
      if (Array.isArray(payload.artifacts)) {
        for (const artifact of payload.artifacts) {
          if (typeof artifact === "string") {
            artifacts.add(compact(artifact, 260));
          }
        }
      }
    }
  }
  return [...artifacts].filter(Boolean).slice(0, 20);
}

function hasOpenWork(board: HermesKanbanBoardSummary): boolean {
  return Object.entries(board.by_status).some(([status, count]) => status !== "done" && count > 0);
}

function numberRecord(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => [key, Number(raw) || 0]));
}

function nestedNumberRecord(value: unknown): Record<string, Record<string, number>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => [key, numberRecord(raw)]));
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compact(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_SECRET]").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...` : text;
}

function formatCommandError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as { code?: unknown; message?: unknown; stderr?: unknown };
    const detail = [
      record.code ? `code=${String(record.code)}` : "",
      record.message ? compact(String(record.message), 180) : "",
      record.stderr ? compact(String(record.stderr), 240) : ""
    ].filter(Boolean).join("; ");
    return detail || "HERMES_KANBAN_COMMAND_FAILED";
  }
  return compact(String(error), 240) || "HERMES_KANBAN_COMMAND_FAILED";
}
