import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CodexAppserverTurnInputSchema, type CodexAppserverTurnInput, type CodexAppserverTurnResult } from "../contracts/codex-appserver.contract.js";
import { redactSensitiveText } from "../runtime/result-envelope.js";

type ClientRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type CodexAppserverClientRunner = (
  request: Record<string, unknown>,
  options: {
    bridgeRoot: string;
    appServerUrl: string;
    dryRun: boolean;
    timeoutSeconds: number;
  }
) => Promise<ClientRunResult>;

export class CodexAppserverTurnService {
  constructor(
    private readonly bridgeRoot: string,
    private readonly runClient: CodexAppserverClientRunner = defaultClientRunner
  ) {}

  async turn(rawInput: CodexAppserverTurnInput): Promise<CodexAppserverTurnResult> {
    const input = CodexAppserverTurnInputSchema.parse(rawInput);
    requireLoopbackWs(input.app_server_url);
    const bindingId = input.binding_id ?? `${input.repo_id}:${input.workstream}:codex-appserver`;
    const correlationId = input.correlation_id ?? `${bindingId}:turn`;
    const bindingAvailable = Boolean(input.target_thread_id);
    const request = {
      repo_id: input.repo_id,
      workstream: input.workstream,
      binding_id: bindingId,
      objective: input.objective,
      correlation_id: correlationId,
      allowed_paths: input.allowed_paths,
      forbidden_paths: input.forbidden_paths,
      acceptance_criteria: input.acceptance_criteria,
      target_thread_id: input.target_thread_id ?? "",
      ...(input.model ? { model: input.model } : {})
    };
    const warnings: string[] = [];
    const client = await this.runClient(request, {
      bridgeRoot: this.bridgeRoot,
      appServerUrl: input.app_server_url,
      dryRun: input.dry_run,
      timeoutSeconds: input.timeout_seconds
    });
    if (client.stderr.trim()) {
      warnings.push("CODEX_APPSERVER_CLIENT_STDERR_REDACTED");
    }
    if (client.status !== 0) {
      return {
        ok: true,
        repo_id: input.repo_id,
        workstream: input.workstream,
        binding_id: bindingId,
        status: "failed",
        dry_run: input.dry_run,
        proof_boundary: "fixed Codex app-server client returned a non-zero exit before a verified turn receipt",
        connection_status: "client_failed",
        app_server_url_scope: "loopback_only",
        bootstrap_used: !bindingAvailable,
        direct_send: bindingAvailable,
        binding_available: bindingAvailable,
        target_thread_id: input.target_thread_id ?? "",
        address: {
          target_thread_id: input.target_thread_id ?? "",
          app_server_url_scope: "loopback_only",
          address_source: bindingAvailable ? "input_target_thread_id" : "bootstrap_required"
        },
        json_rpc_messages: [],
        json_rpc_wire_note: "Codex app-server omits the jsonrpc field on the wire.",
        live_receipt: {
          exit_code: client.status,
          stderr_tail: redactSensitiveText(client.stderr).slice(-2000)
        },
        next_proof_step: "Inspect the fixed client stderr/stdout tail, then retry dry_run before attempting a live WebSocket send.",
        warnings
      };
    }
    const parsed = JSON.parse(client.stdout) as Record<string, unknown>;
    const messageSummaries = summarizeMessages(Array.isArray(parsed.messages) ? parsed.messages : []);
    const liveThreadId = stringField(parsed, "thread_id");
    const targetThreadId = input.target_thread_id ?? liveThreadId;
    const directSend = bindingAvailable;
    const bootstrapUsed = !directSend;
    const status = input.dry_run ? "dry_run" : liveStatus(parsed);
    return {
      ok: true,
      repo_id: input.repo_id,
      workstream: input.workstream,
      binding_id: bindingId,
      status,
      dry_run: input.dry_run,
      proof_boundary: stringField(parsed, "proof_boundary") || (input.dry_run ? "validated outbound JSON-RPC envelope only; no live Codex app-server reached" : "live loopback Codex app-server client receipt"),
      connection_status: stringField(parsed, "connection_status") || (input.dry_run ? "not_attempted" : "attempted"),
      app_server_url_scope: "loopback_only",
      bootstrap_used: bootstrapUsed,
      direct_send: directSend,
      binding_available: bindingAvailable,
      target_thread_id: targetThreadId,
      address: {
        target_thread_id: targetThreadId,
        app_server_url_scope: "loopback_only",
        address_source: directSend ? "input_target_thread_id" : targetThreadId ? "live_response" : "bootstrap_required"
      },
      json_rpc_messages: messageSummaries,
      json_rpc_wire_note: stringField(parsed, "jsonrpc_wire_note") || "Codex app-server omits the jsonrpc field on the wire.",
      ...(input.dry_run ? {} : { live_receipt: parsed }),
      next_proof_step: nextProofStep({ dryRun: input.dry_run, bindingAvailable, targetThreadId, status }),
      warnings
    };
  }
}

function requireLoopbackWs(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "ws:") {
    throw new Error("Only ws:// loopback Codex app-server URLs are allowed.");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Codex app-server direct lane is loopback-only by default.");
  }
  if (!url.port) {
    throw new Error("Codex app-server URL must include an explicit port.");
  }
}

function summarizeMessages(messages: unknown[]): CodexAppserverTurnResult["json_rpc_messages"] {
  return messages.map((message) => {
    const record = typeof message === "object" && message !== null ? message as Record<string, unknown> : {};
    const params = typeof record.params === "object" && record.params !== null ? record.params as Record<string, unknown> : {};
    const input = Array.isArray(params.input) ? params.input : [];
    const promptText = input.map((item) => {
      const itemRecord = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
      return typeof itemRecord.text === "string" ? itemRecord.text : "";
    }).join("\n");
    return {
      method: String(record.method ?? ""),
      ...(typeof record.id === "number" || typeof record.id === "string" ? { id: record.id } : {}),
      params_summary: {
        ...(params.clientInfo ? { has_client_info: true } : {}),
        ...(params.cwd ? { cwd_label: "target_repo_root" } : {}),
        ...(typeof params.sandbox === "string" ? { sandbox: params.sandbox } : {}),
        ...(typeof params.approvalPolicy === "string" ? { approval_policy: params.approvalPolicy } : {}),
        ...(typeof params.threadId === "string" ? { thread_id: params.threadId } : {}),
        ...(input.length > 0 ? { input_items: input.length } : {}),
        ...(promptText ? { prompt_sha256: sha256(promptText), prompt_bytes: Buffer.byteLength(promptText, "utf8") } : {})
      }
    };
  });
}

function liveStatus(parsed: Record<string, unknown>): CodexAppserverTurnResult["status"] {
  if (parsed.completed === true) {
    return "completed";
  }
  if (typeof parsed.timeout_phase === "string" && parsed.timeout_phase) {
    return "blocked";
  }
  if (parsed.status === "connected") {
    return "connected";
  }
  return "blocked";
}

function nextProofStep(input: {
  dryRun: boolean;
  bindingAvailable: boolean;
  targetThreadId: string;
  status: CodexAppserverTurnResult["status"];
}): string {
  if (input.dryRun && input.bindingAvailable) {
    return "Run live mode against the loopback Codex app-server and verify the same target_thread_id receives the turn without bootstrap.";
  }
  if (input.dryRun) {
    return "Bootstrap or supply a target_thread_id, then run a second dry-run showing direct_send true and bootstrap_used false.";
  }
  if (input.status === "completed" && input.targetThreadId) {
    return "Store or confirm the binding, then send a second turn directly to the same target_thread_id.";
  }
  if (input.status === "blocked") {
    return "Inspect live_receipt.event_shape_tail and timeout_phase before claiming direct delivery; retry only after a terminal completion event can be observed.";
  }
  return "Capture a live app-server thread_id/turn_id receipt before claiming direct delivery.";
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function defaultClientRunner(
  request: Record<string, unknown>,
  options: { bridgeRoot: string; appServerUrl: string; dryRun: boolean; timeoutSeconds: number }
): Promise<ClientRunResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "codex-appserver-turn-"));
  const requestPath = join(tempDir, "request.json");
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  const args = [
    "projects/agent-runner/codex_appserver_direct.py",
    "--request-json",
    requestPath,
    "--bridge-root",
    options.bridgeRoot,
    "--app-server-url",
    options.appServerUrl,
    "--timeout-seconds",
    String(options.timeoutSeconds)
  ];
  if (options.dryRun) {
    args.push("--dry-run");
  }
  try {
    return await spawnAndCapture("python", args, options.bridgeRoot, options.timeoutSeconds * 1000);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function spawnAndCapture(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ClientRunResult> {
  const child = spawn(command, args, {
    cwd,
    shell: false,
    windowsHide: true,
    env: {
      PATH: process.env.PATH ?? "",
      Path: process.env.Path ?? process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? process.env.SystemRoot ?? "",
      SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "",
      TEMP: process.env.TEMP ?? "",
      TMP: process.env.TMP ?? ""
    }
  });
  const stdout = new CappedOutput(64_000);
  const stderr = new CappedOutput(8_000);
  child.stdout.on("data", (chunk) => stdout.append(chunk));
  child.stderr.on("data", (chunk) => stderr.append(chunk));
  const timeout = setTimeout(() => child.kill(), timeoutMs);
  const exit = await new Promise<{ code: number | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code }));
  }).finally(() => clearTimeout(timeout));
  return {
    status: exit.code,
    stdout: stdout.value(),
    stderr: stderr.value()
  };
}

class CappedOutput {
  private text = "";

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer | string): void {
    this.text += chunk.toString();
    while (Buffer.byteLength(this.text, "utf8") > this.maxBytes) {
      this.text = this.text.slice(1);
    }
  }

  value(): string {
    return this.text;
  }
}
