import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

const JsonObjectSchema = z.object({}).passthrough();

export const TownPortalReturnInputSchema = RepoInputSchema.extend({
  lab_mode: z.literal("town_portal_advisory_v0").optional()
    .describe("Advisory gate for the existing source prototype. This route remains lab-scoped."),
  production_mode: z.literal("town_portal_production_v0").optional()
    .describe("Source-level production gate. This does not prove live ChatGPT-callable exposure."),
  portal: JsonObjectSchema.nullable()
    .describe("Bridge-opened Town Portal handle to validate and consume. Null returns missing_portal without consuming a handle."),
  payload: JsonObjectSchema
    .describe("Single display-only Town Portal payload to validate before any adapter handoff."),
  current_state_hash: z.string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .describe("Current semantic observed-state hash used for conflict detection."),
  turn_id: z.string().min(1)
    .describe("Current request-window or chat-turn id. Must match the portal expiry turn id."),
  approval_present: z.boolean().optional()
    .describe("Whether explicit human approval is present for approval-required display writes.")
});

export const TownPortalReturnResultSchema = z.object({
  kind: z.literal("town_portal_return_result"),
  status: z.enum(["accepted", "rejected", "expired", "conflict", "missing_portal"]),
  reason: z.string(),
  terminal: z.literal(true),
  consume_handle: z.boolean(),
  adapter_called: z.boolean(),
  handoff: z.object({
    repo_id: z.string(),
    target_path: z.string(),
    operation: z.string(),
    payload_kind: z.string()
  }).optional(),
  audit_receipt: z.object({
    kind: z.literal("town_portal_audit_receipt"),
    portal_id: z.string(),
    status: z.literal("accepted"),
    reason: z.literal("accepted_once"),
    adapter: z.literal("knowledge_display_write_v0"),
    artifact_path: z.string(),
    operation: z.string(),
    payload_kind: z.string(),
    state_hash: z.string()
  }).optional(),
  conflict: z.object({
    kind: z.literal("town_portal_conflict"),
    portal_id: z.string(),
    old_state_hash: z.string(),
    current_state_hash: z.string(),
    next: z.literal("refresh_state")
  }).optional()
});

export type TownPortalReturnInput = z.input<typeof TownPortalReturnInputSchema>;
export type TownPortalReturnResult = z.infer<typeof TownPortalReturnResultSchema>;
