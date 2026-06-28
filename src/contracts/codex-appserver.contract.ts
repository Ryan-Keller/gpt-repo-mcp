import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

const NonEmptyStringSchema = z.string().min(1);
const StringListSchema = z.array(z.string().min(1)).default([]);

export const CodexAppserverTurnInputSchema = RepoInputSchema.extend({
  workstream: z.string().min(1).max(120).default("default").describe("Stable workstream key for the target Codex thread binding."),
  binding_id: z.string().min(1).max(200).optional().describe("Optional explicit binding key. Defaults to repo_id plus workstream."),
  objective: NonEmptyStringSchema.describe("Concrete prompt or objective to send to the Codex app-server lane."),
  allowed_paths: StringListSchema.describe("Repo-relative paths the target Codex turn may modify."),
  forbidden_paths: StringListSchema.describe("Repo-relative paths the target Codex turn must not modify."),
  acceptance_criteria: StringListSchema.describe("Bounded success criteria the target Codex turn should satisfy."),
  dry_run: z.boolean().default(true).describe("When true, validate and return the outbound JSON-RPC envelope without opening a WebSocket."),
  app_server_url: z.string().min(1).default("ws://127.0.0.1:4500").describe("Loopback ws:// Codex app-server URL. Non-loopback URLs are rejected by default."),
  target_thread_id: z.string().min(1).max(300).optional().describe("Previously stored target Codex thread id. When supplied, bootstrap is bypassed and turn/start targets this thread directly."),
  correlation_id: z.string().min(1).max(200).optional().describe("Optional caller correlation id used in receipts. Generated from binding metadata when omitted."),
  model: z.string().min(1).max(120).optional().describe("Optional Codex model hint passed to thread/start only when bootstrap/thread creation is needed."),
  timeout_seconds: z.number().int().positive().max(600).default(120).describe("Maximum live WebSocket wait time. Ignored for dry_run.")
});

const JsonRpcMessageSummarySchema = z.object({
  method: z.string(),
  id: z.union([z.number(), z.string()]).optional(),
  params_summary: z.object({
    has_client_info: z.boolean().optional(),
    cwd_label: z.string().optional(),
    sandbox: z.string().optional(),
    approval_policy: z.string().optional(),
    thread_id: z.string().optional(),
    input_items: z.number().int().nonnegative().optional(),
    prompt_sha256: z.string().optional(),
    prompt_bytes: z.number().int().nonnegative().optional()
  })
});

export const CodexAppserverTurnResultSchema = z.object({
  ok: z.literal(true),
  repo_id: z.string(),
  workstream: z.string(),
  binding_id: z.string(),
  status: z.enum(["dry_run", "completed", "connected", "failed", "blocked"]),
  dry_run: z.boolean(),
  proof_boundary: z.string(),
  connection_status: z.string(),
  app_server_url_scope: z.literal("loopback_only"),
  bootstrap_used: z.boolean(),
  direct_send: z.boolean(),
  binding_available: z.boolean(),
  target_thread_id: z.string(),
  address: z.object({
    target_thread_id: z.string(),
    app_server_url_scope: z.literal("loopback_only"),
    address_source: z.enum(["input_target_thread_id", "bootstrap_required", "live_response"])
  }),
  json_rpc_messages: z.array(JsonRpcMessageSummarySchema),
  json_rpc_wire_note: z.string(),
  live_receipt: z.object({}).passthrough().optional(),
  next_proof_step: z.string(),
  warnings: z.array(z.string())
});

export type CodexAppserverTurnInput = z.input<typeof CodexAppserverTurnInputSchema>;
export type CodexAppserverTurnResult = z.infer<typeof CodexAppserverTurnResultSchema>;
