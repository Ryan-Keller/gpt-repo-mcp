import { getRequestTelemetry } from "./telemetry.js";
import type { ConnectorIdentitySnapshot } from "../contracts/connector-identity.contract.js";

export function buildConnectorIdentitySnapshot(input: {
  serverCatalogHasRepoConnectorWhoami?: boolean;
} = {}): ConnectorIdentitySnapshot {
  const telemetry = getRequestTelemetry();
  const routeTokenValid = telemetry?.route_token_valid === true;
  const authorizationHeaderPresent = telemetry?.authorization_header_present === true;
  const bridgeAuthHeaderPresent = telemetry?.bridge_auth_header_present === true;
  const cloudflareAccessPresent = telemetry?.cloudflare_access_email_present === true ||
    telemetry?.cloudflare_access_jwt_present === true;
  const pathTokenConnectorAuthEnabled = process.env.BRIDGE_ALLOW_PATH_TOKEN_CONNECTOR_AUTH === "1" ||
    process.env.GPT_REPO_ALLOW_PATH_TOKEN_CONNECTOR_AUTH === "1" ||
    process.env.REPO_READER_ALLOW_PATH_TOKEN_CONNECTOR_AUTH === "1";
  const authMode = routeTokenValid && pathTokenConnectorAuthEnabled
    ? "path_token_compatibility"
    : authorizationHeaderPresent || bridgeAuthHeaderPresent
      ? "header_auth_candidate"
      : cloudflareAccessPresent
        ? "cloudflare_access_candidate"
        : "unknown_or_public";

  return {
    observed_at: new Date().toISOString(),
    route: telemetry?.route ?? "unknown",
    http_method: telemetry?.http_method ?? "unknown",
    mcp_method: telemetry?.mcp_method ?? "unknown",
    mcp_tool: telemetry?.mcp_tool ?? "unknown",
    mcp_session: telemetry?.mcp_session ?? "unknown",
    session_fingerprint: telemetry?.session_fingerprint ?? "",
    auth_mode: authMode,
    path_token_connector_auth_enabled: pathTokenConnectorAuthEnabled,
    public_path_token_configured: Boolean(process.env.GPT_REPO_PUBLIC_PATH_TOKEN || process.env.REPO_READER_PUBLIC_PATH_TOKEN),
    route_token_present: telemetry?.route_token_present === true,
    route_token_valid: routeTokenValid,
    authorization_header_present: authorizationHeaderPresent,
    bridge_auth_header_present: bridgeAuthHeaderPresent,
    cloudflare_access_email_present: telemetry?.cloudflare_access_email_present === true,
    cloudflare_access_jwt_present: telemetry?.cloudflare_access_jwt_present === true,
    cf_ray_present: telemetry?.cf_ray_present === true,
    forwarded_proto: telemetry?.forwarded_proto ?? "",
    server_catalog_has_repo_connector_whoami: input.serverCatalogHasRepoConnectorWhoami ?? true,
    chatgpt_callable_surface_verified: false,
    callable_surface_warning: "Server catalog exposure does not prove this ChatGPT chat exposes every callable tool. If repo_connector_whoami is missing, use this connector_identity object from stable status tools.",
    suggested_next_action: suggestedNextAction(authMode)
  };
}

function suggestedNextAction(authMode: ConnectorIdentitySnapshot["auth_mode"]): string {
  switch (authMode) {
    case "path_token_compatibility":
      return "Treat the full tokenized connector URL as secret-bearing material; keep this fallback until header auth is proven in ChatGPT.";
    case "header_auth_candidate":
      return "Header-auth mode may be viable; test discovery and tools/call in a fresh connector session before disabling path-token compatibility.";
    case "cloudflare_access_candidate":
      return "Cloudflare Access identity material is present; evaluate whether it is stable enough for connector policy.";
    default:
      return "No stable connector identity signal observed; validate connector auth and route before blaming the runner.";
  }
}
