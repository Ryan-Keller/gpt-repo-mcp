import { describe, expect, test } from "vitest";
import {
  ACCESS_MATRIX,
  authorizeBridgeRequest,
  buildBridgeAuthConfig,
  buildPublicSafeHealth,
  getToolAccessTier
} from "../src/runtime/access-control.js";

describe("bridge access control", () => {
  test("classifies sensitive bridge tools into documented access tiers", () => {
    expect(ACCESS_MATRIX.public_safe).toEqual(expect.arrayContaining(["GET /health unauthenticated"]));
    expect(getToolAccessTier("repo_list_roots")).toBe("authenticated_read");
    expect(getToolAccessTier("repo_runner_status")).toBe("authenticated_read");
    expect(getToolAccessTier("ready_results")).toBe("authenticated_read");
    expect(getToolAccessTier("repo_write_codex_task")).toBe("privileged_write");
    expect(getToolAccessTier("repo_write_codex_tasks_batch")).toBe("privileged_write");
    expect(getToolAccessTier("repo_write_file")).toBe("privileged_write");
    expect(getToolAccessTier("repo_write_commit")).toBe("dangerous_git");
    expect(getToolAccessTier("repo_write_recover")).toBe("dangerous_git");
    expect(getToolAccessTier("local_ollama_vision")).toBe("local_only");
  });

  test("renders public-safe health without leaking internal diagnostics", () => {
    const health = buildPublicSafeHealth({
      now: "2026-06-07T20:45:00.000Z",
      status: "locked",
      authenticationRequired: true
    });
    const serialized = JSON.stringify(health);

    expect(health).toEqual({
      ok: true,
      name: "gpt-repo-mcp",
      alive: true,
      status: "locked",
      timestamp: "2026-06-07T20:45:00.000Z",
      authentication_required: true
    });
    expect(serialized).not.toContain("repo_id");
    expect(serialized).not.toContain("tool_catalog_hash");
    expect(serialized).not.toContain("run_id");
    expect(serialized).not.toContain("ollama");
    expect(serialized).not.toContain("M:\\");
  });

  test("requires token for sensitive public/tunnel access and accepts bearer or connector header", () => {
    const config = buildBridgeAuthConfig({
      authToken: "secret-token",
      publicPathToken: "public-path-token"
    });

    expect(authorizeBridgeRequest({
      config,
      accessTier: "authenticated_read",
      operation: "repo_runner_status",
      headers: {},
      publicPathTokenAuthenticated: true
    })).toMatchObject({
      allowed: false,
      caller_classification: "public",
      reason: "missing_or_invalid_auth_token",
      http_status: 401
    });

    expect(authorizeBridgeRequest({
      config,
      accessTier: "authenticated_read",
      operation: "repo_runner_status",
      headers: { authorization: "Bearer secret-token" }
    })).toMatchObject({
      allowed: true,
      caller_classification: "authenticated",
      reason: "auth_token_valid"
    });

    expect(authorizeBridgeRequest({
      config,
      accessTier: "privileged_write",
      operation: "repo_write_codex_task",
      headers: { "x-bridge-auth-token": "secret-token" }
    })).toMatchObject({
      allowed: true,
      caller_classification: "connector",
      reason: "auth_token_valid"
    });
  });

  test("locks public/tunnel sensitive access when no app token is configured", () => {
    const config = buildBridgeAuthConfig({
      publicPathToken: "public-path-token"
    });

    expect(config.warning).toBe("BRIDGE_AUTH_TOKEN missing while public/tunnel MCP path is enabled");
    expect(authorizeBridgeRequest({
      config,
      accessTier: "privileged_write",
      operation: "repo_write_codex_task",
      headers: {},
      publicPathTokenAuthenticated: true
    })).toMatchObject({
      allowed: false,
      reason: "auth_not_configured_for_public_mode",
      suggested_next_action: "set_BRIDGE_AUTH_TOKEN_and_configure_connector_header"
    });
  });

  test("allows explicit path-token connector auth compatibility mode", () => {
    const config = buildBridgeAuthConfig({
      authToken: "secret-token",
      publicPathToken: "public-path-token",
      allowPathTokenConnectorAuth: "1"
    });

    expect(authorizeBridgeRequest({
      config,
      accessTier: "authenticated_read",
      operation: "repo_list_roots",
      headers: {},
      publicPathTokenAuthenticated: true
    })).toMatchObject({
      allowed: true,
      caller_classification: "connector",
      reason: "public_path_token_connector_auth_allowed"
    });
  });
});
