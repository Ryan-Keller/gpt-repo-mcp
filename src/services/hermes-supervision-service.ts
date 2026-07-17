import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type { HermesInterventionInput, HermesInterventionResult } from "../contracts/hermes-supervision.contract.js";
import { redactSensitiveText } from "../runtime/result-envelope.js";

const DEFAULT_TRANSACTION_ROOT = "D:\\HermesDesktop\\workspace\\handoff\\off-thread";
const TRANSACTION_PATTERN = /^offthread-[a-f0-9]{16}$/;
const REQUIRED_RECEIPTS = [
  "skills-receipt.md",
  "environment-receipt.json",
  "usage-receipt.json",
  "satisfaction-receipt.md",
  "RESULT.md"
] as const;

export type HermesSupervisionEvent = {
  cursor: string;
  observed_at: string;
  event_type: string;
  source: string;
  summary: string;
};

export type HermesSupervisionTransaction = {
  transaction_id: string;
  operator_status: string;
  board: string;
  task_id: string;
  repo_path: string;
  off_thread_status: string;
  worker_status: string;
  kanban_status: string;
  acceptance_status: string;
  accepted: boolean;
  satisfaction_gate: number | null;
  return_armed: boolean;
  last_observed_at: string;
  required_receipts: Array<{ name: string; present: boolean; updated_at: string }>;
  checkpoint_path: string;
  intervention_receipt_path: string;
  live_tail: HermesSupervisionEvent[];
  next_cursor: string;
  next_action: string;
};

export type HermesSupervisionStatus = {
  state: "available" | "unavailable" | "blocked";
  requested_transaction: string;
  transaction_root: string;
  transaction_count: number;
  transactions: HermesSupervisionTransaction[];
  evidence: string[];
  warnings: string[];
  safe_operations: string[];
  blocked_operations: string[];
  suggested_next_action: string;
};

export class HermesSupervisionService {
  private readonly root: string;

  constructor(transactionRoot = process.env.HERMES_OFF_THREAD_ROOT ?? DEFAULT_TRANSACTION_ROOT) {
    this.root = resolve(transactionRoot);
  }

  async status(input: {
    transaction?: string;
    board?: string;
    cursor?: string;
    maxEvents?: number;
    maxTransactions?: number;
  } = {}): Promise<HermesSupervisionStatus> {
    if (input.transaction && !TRANSACTION_PATTERN.test(input.transaction)) {
      return this.blocked(input.transaction, "HERMES_INVALID_TRANSACTION_ID");
    }
    try {
      const ids = input.transaction
        ? [input.transaction]
        : await this.recentTransactionIds(input.maxTransactions ?? 3);
      const transactions: HermesSupervisionTransaction[] = [];
      for (const id of ids) {
        const summary = await this.readTransaction(id, input.cursor ?? "", input.maxEvents ?? 12);
        if (summary && (!input.board || summary.board === input.board)) {
          transactions.push(summary);
        }
      }
      return {
        state: transactions.length ? "available" : "unavailable",
        requested_transaction: input.transaction ?? "",
        transaction_root: this.root,
        transaction_count: transactions.length,
        transactions,
        evidence: transactions.length
          ? [`Read ${transactions.length} Hermes off-thread transaction(s) from durable transaction artifacts.`]
          : ["No matching Hermes off-thread transaction artifacts were found."],
        warnings: [],
        safe_operations: ["observe_transaction", "read_compact_live_tail", "inspect_receipt_gate", "append_bounded_checkpoint_via_repo_hermes_intervene"],
        blocked_operations: ["arbitrary_shell", "direct_target_repo_write", "acceptance_override", "process_kill", "automatic_reconcile", "secret_readback"],
        suggested_next_action: transactions.some((item) => !item.accepted)
          ? "report_latest_evidence_then_watch_or_append_a_bounded_checkpoint"
          : "report_acceptance_and_artifact_receipts"
      };
    } catch (error) {
      return this.blocked(input.transaction ?? "", compactError(error));
    }
  }

  async intervene(input: HermesInterventionInput): Promise<HermesInterventionResult> {
    if (!TRANSACTION_PATTERN.test(input.transaction_id)) {
      return this.rejected(input, "HERMES_INVALID_TRANSACTION_ID");
    }
    const dir = this.transactionDir(input.transaction_id);
    const transaction = await this.readJson(join(dir, "transaction.json"));
    const status = stringValue(transaction.off_thread_status);
    if (["accepted", "cancelled"].includes(status)) {
      return this.rejected(input, `HERMES_TRANSACTION_TERMINAL:${status}`);
    }

    const observedAt = new Date().toISOString();
    const interventionId = `chatgpt-${observedAt.replace(/[-:.]/g, "").replace("Z", "Z")}-${randomUUID().slice(0, 8)}`;
    const checkpointPath = join(dir, "CHECKPOINTS.md");
    const receiptPath = join(dir, "chatgpt-interventions.jsonl");
    const instruction = safeText(input.instruction, 6000);
    const reason = safeText(input.reason ?? "", 1500);
    const expectedEvidence = safeText(input.expected_evidence ?? "", 2000);
    const block = [
      `ChatGPT intervention (${observedAt}, ${input.intervention_type}, ${interventionId}):`,
      "",
      instruction,
      ...(reason ? ["", `Reason: ${reason}`] : []),
      ...(expectedEvidence ? ["", `Expected evidence: ${expectedEvidence}`] : []),
      "",
      "Record the outcome in the transaction receipts, then resume the original objective."
    ].join("\n");
    await this.appendCheckpointAtomic(checkpointPath, block);
    await appendFile(receiptPath, `${JSON.stringify({
      schema_version: 1,
      intervention_id: interventionId,
      transaction_id: input.transaction_id,
      intervention_type: input.intervention_type,
      instruction,
      reason,
      expected_evidence: expectedEvidence,
      observed_at: observedAt,
      source: "chatgpt-gpt-repo-mcp"
    })}\n`, "utf8");
    return {
      ok: true,
      status: "checkpoint_appended",
      repo_id: input.repo_id,
      transaction_id: input.transaction_id,
      intervention_id: interventionId,
      intervention_type: input.intervention_type,
      operator_status: stringValue(transaction.operator_status) || "Hermes transaction checkpoint updated.",
      checkpoint_path: this.relativeDisplayPath(checkpointPath),
      receipt_path: this.relativeDisplayPath(receiptPath),
      observed_at: observedAt,
      next_action: "return_to_repo_runner_status_hermes_kanban_and_watch_for_checkpoint_evidence",
      warnings: input.intervention_type.endsWith("_request")
        ? ["REQUEST_RECORDED_NOT_PROCESS_CONTROL: pause/resume requests do not directly stop or start a worker."]
        : []
    };
  }

  private async recentTransactionIds(maxTransactions: number): Promise<string[]> {
    const entries = await readdir(this.root, { withFileTypes: true });
    const candidates = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && TRANSACTION_PATTERN.test(entry.name))
      .map(async (entry) => ({ id: entry.name, mtime: (await stat(join(this.root, entry.name, "transaction.json"))).mtimeMs })));
    return candidates.sort((a, b) => b.mtime - a.mtime)
      .slice(0, Math.max(1, Math.min(maxTransactions, 10)))
      .map((item) => item.id);
  }

  private async readTransaction(id: string, cursor: string, maxEvents: number): Promise<HermesSupervisionTransaction | undefined> {
    try {
      const dir = this.transactionDir(id);
      const transactionPath = join(dir, "transaction.json");
      const transaction = await this.readJson(transactionPath);
      const acceptance = await this.tryReadJson(join(dir, "acceptance-receipt.json"));
      const events = await this.collectEvents(dir, transaction, acceptance);
      const filtered = events.filter((event) => !cursor || event.cursor > cursor)
        .slice(-Math.max(1, Math.min(maxEvents, 50)));
      const receiptStates = await Promise.all(REQUIRED_RECEIPTS.map(async (name) => {
        try {
          const info = await stat(join(dir, name));
          return { name, present: true, updated_at: info.mtime.toISOString() };
        } catch {
          return { name, present: false, updated_at: "" };
        }
      }));
      const acceptanceStatus = stringValue(acceptance.status);
      const accepted = acceptanceStatus === "accepted";
      return {
        transaction_id: id,
        operator_status: safeText(accepted ? "Hermes transaction accepted." : stringValue(transaction.operator_status) || deriveOperatorStatus(transaction, false), 240),
        board: safeText(stringValue(transaction.board), 160),
        task_id: safeText(stringValue(transaction.task_id), 100),
        repo_path: safeText(stringValue(transaction.repo_path), 300),
        off_thread_status: safeText(stringValue(transaction.off_thread_status), 60),
        worker_status: safeText(stringValue(transaction.worker_status), 60),
        kanban_status: safeText(stringValue(transaction.kanban_status), 60),
        acceptance_status: acceptanceStatus || "not_available",
        accepted,
        satisfaction_gate: numberValue(transaction.satisfaction_gate),
        return_armed: transaction.return_armed === true,
        last_observed_at: safeText(stringValue(transaction.last_observed_at_utc) || stringValue(transaction.worker_completed_at_utc), 80),
        required_receipts: receiptStates,
        checkpoint_path: this.relativeDisplayPath(join(dir, "CHECKPOINTS.md")),
        intervention_receipt_path: this.relativeDisplayPath(join(dir, "chatgpt-interventions.jsonl")),
        live_tail: filtered,
        next_cursor: filtered.at(-1)?.cursor ?? cursor,
        next_action: accepted
          ? "report_accepted_result_and_receipts"
          : filtered.some((event) => event.event_type.includes("error") || event.event_type.includes("stderr"))
            ? "inspect_tripwire_and_consider_bounded_intervention"
            : "continue_watching_for_new_evidence"
      };
    } catch {
      return undefined;
    }
  }

  private async collectEvents(dir: string, transaction: Record<string, unknown>, acceptance: Record<string, unknown>): Promise<HermesSupervisionEvent[]> {
    const events: Array<Omit<HermesSupervisionEvent, "cursor">> = [];
    const transactionInfo = await stat(join(dir, "transaction.json"));
    events.push({
      observed_at: transactionInfo.mtime.toISOString(),
      event_type: "transaction_status",
      source: "transaction.json",
      summary: safeText(stringValue(acceptance.status) === "accepted"
        ? "Hermes transaction accepted."
        : stringValue(transaction.operator_status) || deriveOperatorStatus(transaction, false), 400)
    });
    await this.addCheckpointEvents(dir, events);
    await this.addInterventionEvents(dir, events);
    await this.addProcessLogEvents(dir, events);
    await this.addReceiptEvents(dir, events);
    return events
      .map((event) => ({ ...event, cursor: eventCursor(event) }))
      .sort((left, right) => left.cursor.localeCompare(right.cursor));
  }

  private async addCheckpointEvents(dir: string, events: Array<Omit<HermesSupervisionEvent, "cursor">>): Promise<void> {
    const path = join(dir, "CHECKPOINTS.md");
    try {
      const text = await readFile(path, "utf8");
      const info = await stat(path);
      const blocks = text.split(/\n(?=(?:Watcher|ChatGPT intervention)\b)/i).slice(-8);
      for (const block of blocks) {
        if (!/^(Watcher|ChatGPT intervention)\b/i.test(block.trim())) continue;
        const timestamp = block.match(/\((\d{4}-\d{2}-\d{2}T[^,)]+Z)/)?.[1] ?? info.mtime.toISOString();
        events.push({
          observed_at: normalizeIso(timestamp, info.mtime.toISOString()),
          event_type: /^ChatGPT intervention/i.test(block.trim()) ? "chatgpt_intervention" : "watcher_checkpoint",
          source: "CHECKPOINTS.md",
          summary: safeText(block, 700)
        });
      }
    } catch {
      // Optional checkpoint evidence may not exist yet.
    }
  }

  private async addInterventionEvents(dir: string, events: Array<Omit<HermesSupervisionEvent, "cursor">>): Promise<void> {
    try {
      const lines = (await readFile(join(dir, "chatgpt-interventions.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).slice(-10);
      for (const line of lines) {
        const record = JSON.parse(line) as Record<string, unknown>;
        events.push({
          observed_at: normalizeIso(stringValue(record.observed_at), new Date(0).toISOString()),
          event_type: "chatgpt_intervention_receipt",
          source: "chatgpt-interventions.jsonl",
          summary: safeText(`${stringValue(record.intervention_type)}: ${stringValue(record.instruction)}`, 700)
        });
      }
    } catch {
      // Optional intervention evidence may not exist yet.
    }
  }

  private async addProcessLogEvents(dir: string, events: Array<Omit<HermesSupervisionEvent, "cursor">>): Promise<void> {
    const logsDir = join(dir, "process-logs");
    try {
      const entries = await readdir(logsDir, { withFileTypes: true });
      const files = await Promise.all(entries.filter((entry) => entry.isFile() && /\.(stdout|stderr)\.log$/i.test(entry.name)).map(async (entry) => ({
        name: entry.name,
        path: join(logsDir, entry.name),
        info: await stat(join(logsDir, entry.name))
      })));
      for (const file of files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs).slice(0, 4)) {
        const lines = (await readFile(file.path, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-4);
        if (!lines.length) continue;
        events.push({
          observed_at: file.info.mtime.toISOString(),
          event_type: file.name.includes("stderr") ? "process_stderr_tail" : "process_stdout_tail",
          source: `process-logs/${file.name}`,
          summary: safeText(lines.join(" | "), 700)
        });
      }
    } catch {
      // Optional process-log evidence may not exist yet.
    }
  }

  private async addReceiptEvents(dir: string, events: Array<Omit<HermesSupervisionEvent, "cursor">>): Promise<void> {
    for (const name of ["worker-result.json", "RESULT.md", "satisfaction-receipt.md", "acceptance-receipt.json"]) {
      const path = join(dir, name);
      try {
        const info = await stat(path);
        const text = await readFile(path, "utf8");
        events.push({
          observed_at: info.mtime.toISOString(),
          event_type: name === "acceptance-receipt.json" ? "acceptance_receipt" : "worker_receipt",
          source: name,
          summary: safeText(text, 700)
        });
      } catch {
        // Optional receipt evidence may not exist yet.
      }
    }
  }

  private async appendCheckpointAtomic(path: string, block: string): Promise<void> {
    await mkdir(resolve(path, ".."), { recursive: true });
    let current = "# Checkpoint Queue\n";
    try {
      current = await readFile(path, "utf8");
    } catch {
      // A missing queue starts from the default heading.
    }
    const next = `${current.trimEnd()}\n\n${block.trim()}\n`;
    const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temp, next, "utf8");
    await rename(temp, path);
  }

  private transactionDir(id: string): string {
    const candidate = resolve(this.root, id);
    if (!candidate.startsWith(`${this.root}${sep}`) && candidate !== this.root) {
      throw new Error("HERMES_TRANSACTION_PATH_ESCAPE");
    }
    return candidate;
  }

  private async readJson(path: string): Promise<Record<string, unknown>> {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HERMES_INVALID_JSON_OBJECT");
    return value as Record<string, unknown>;
  }

  private async tryReadJson(path: string): Promise<Record<string, unknown>> {
    try { return await this.readJson(path); } catch { return {}; }
  }

  private relativeDisplayPath(path: string): string {
    return `off-thread/${basename(resolve(path, ".."))}/${basename(path)}`;
  }

  private rejected(input: HermesInterventionInput, warning: string): HermesInterventionResult {
    return {
      ok: false,
      status: "rejected",
      repo_id: input.repo_id,
      transaction_id: input.transaction_id,
      intervention_id: "",
      intervention_type: input.intervention_type,
      operator_status: "Intervention rejected before write.",
      checkpoint_path: "",
      receipt_path: "",
      observed_at: new Date().toISOString(),
      next_action: "inspect_transaction_status_and_retry_only_if_the_transaction_is_active",
      warnings: [warning]
    };
  }

  private blocked(transaction: string, warning: string): HermesSupervisionStatus {
    return {
      state: "blocked",
      requested_transaction: transaction,
      transaction_root: this.root,
      transaction_count: 0,
      transactions: [],
      evidence: ["Hermes supervision readback was blocked before returning transaction evidence."],
      warnings: [warning],
      safe_operations: ["observe_transaction", "read_compact_live_tail"],
      blocked_operations: ["arbitrary_shell", "direct_target_repo_write", "acceptance_override"],
      suggested_next_action: "verify_the_transaction_id_and_local_Hermes_transaction_root"
    };
  }
}

function deriveOperatorStatus(transaction: Record<string, unknown>, accepted: boolean): string {
  if (accepted) return "Hermes transaction accepted.";
  const worker = stringValue(transaction.worker_status);
  if (["starting", "running"].includes(worker)) return "Hermes is working.";
  if (worker === "completed") return "Hermes finished worker execution; acceptance proof is still pending.";
  return "Hermes transaction status requires review.";
}

function eventCursor(event: Omit<HermesSupervisionEvent, "cursor">): string {
  const hash = createHash("sha256").update(`${event.source}\n${event.event_type}\n${event.summary}`).digest("hex").slice(0, 12);
  return `${event.observed_at}|${hash}`;
}

function safeText(value: string, maxLength: number): string {
  const compact = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3).trimEnd()}...` : compact;
}

function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function numberValue(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function normalizeIso(value: string, fallback: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}
function compactError(error: unknown): string {
  return safeText(error instanceof Error ? error.message : String(error), 300) || "HERMES_SUPERVISION_FAILED";
}
