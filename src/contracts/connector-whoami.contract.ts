import { z } from "zod";

export const ConnectorWhoamiInputSchema = z.object({});

export const ConnectorWhoamiResultSchema = z.object({
  ok: z.literal(true),
  observed_at: z.string(),
  bridge_process_id: z.number(),
  bridge_started_at: z.string(),
  route: z.string(),
  http_method: z.string(),
  mcp_method: z.string(),
  mcp_tool: z.string(),
  mcp_session: z.enum(["present", "missing", "unknown"]),
  session_fingerprint: z.string(),
  authentication_required: z.boolean(),
  auth_status: z.string(),
  path_token_connector_auth: z.enum(["enabled", "disabled"]),
  public_path_token_configured: z.boolean(),
  route_token_present: z.boolean(),
  route_token_valid: z.boolean(),
  authorization_header_present: z.boolean(),
  bridge_auth_header_present: z.boolean(),
  cloudflare_access_email_present: z.boolean(),
  cloudflare_access_jwt_present: z.boolean(),
  cf_ray_present: z.boolean(),
  forwarded_proto: z.string(),
  caller_classification_hint: z.enum(["tokenized_route", "header_auth_candidate", "cloudflare_access_candidate", "public_or_unknown"]),
  interpretation: z.string(),
  suggested_next_action: z.string()
});

export type ConnectorWhoamiInput = z.infer<typeof ConnectorWhoamiInputSchema>;
export type ConnectorWhoamiResult = z.infer<typeof ConnectorWhoamiResultSchema>;
