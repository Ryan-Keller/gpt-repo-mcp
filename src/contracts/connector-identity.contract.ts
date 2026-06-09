import { z } from "zod";

export const ConnectorIdentitySnapshotSchema = z.any();

export type ConnectorIdentitySnapshot = {
  observed_at: string;
  route: string;
  http_method: string;
  mcp_method: string;
  mcp_tool: string;
  mcp_session: "present" | "missing" | "unknown";
  session_fingerprint: string;
  auth_mode: "path_token_compatibility" | "header_auth_candidate" | "cloudflare_access_candidate" | "unknown_or_public";
  path_token_connector_auth_enabled: boolean;
  public_path_token_configured: boolean;
  route_token_present: boolean;
  route_token_valid: boolean;
  authorization_header_present: boolean;
  bridge_auth_header_present: boolean;
  cloudflare_access_email_present: boolean;
  cloudflare_access_jwt_present: boolean;
  cf_ray_present: boolean;
  forwarded_proto: string;
  server_catalog_has_repo_connector_whoami: boolean;
  chatgpt_callable_surface_verified: boolean;
  callable_surface_warning: string;
  suggested_next_action: string;
};
