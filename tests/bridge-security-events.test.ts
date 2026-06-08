import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { appendBridgeSecurityEvent } from "../src/runtime/bridge-security-events.js";
import { RootRegistry } from "../src/services/root-registry.js";

describe("bridge security events", () => {
  test("persists audit-friendly auth denial events without secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "bridge-security-events-"));
    await mkdir(root, { recursive: true });
    const registry = await RootRegistry.fromConfig({
      repos: [{ repo_id: "fixture", display_name: "Fixture", root }],
      limits: {}
    });

    await appendBridgeSecurityEvent(registry, {
      event_type: "auth_denied",
      severity: "warning",
      caller_classification: "public",
      operation: "repo_write_codex_task",
      allowed: false,
      reason: "Authorization: Bearer secret-token was missing",
      suggested_next_action: "set_BRIDGE_AUTH_TOKEN_and_configure_connector_header"
    });

    const raw = await readFile(join(root, ".chatgpt/events/bridge-events.jsonl"), "utf8");
    const event = JSON.parse(raw.trim()) as Record<string, unknown>;

    expect(event).toMatchObject({
      event_id: expect.stringMatching(/^security:auth_denied:/),
      event_type: "auth_denied",
      severity: "warning",
      caller_classification: "public",
      operation: "repo_write_codex_task",
      allowed: false,
      reason: expect.stringContaining("[REDACTED_SECRET]"),
      suggested_next_action: "set_BRIDGE_AUTH_TOKEN_and_configure_connector_header",
      acknowledged: false,
      unread: true,
      retention_policy: "keep_last_500"
    });
    expect(raw).not.toContain("secret-token");
    expect(raw).not.toContain("Authorization:");
  });

  test("persists session failure events with structured evidence and acknowledgement policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "bridge-session-events-"));
    await mkdir(root, { recursive: true });
    const registry = await RootRegistry.fromConfig({
      repos: [{ repo_id: "fixture", display_name: "Fixture", root }],
      limits: {}
    });

    await appendBridgeSecurityEvent(registry, {
      event_type: "tool_session_terminated",
      severity: "warning",
      caller_classification: "connector",
      operation: "repo_list_roots",
      allowed: false,
      reason: "Bad Request: no valid MCP session",
      evidence: {
        request_id: "req-1",
        mcp_session: "present",
        session_fingerprint: "abc123",
        json_rpc_error_code: -32000,
        bridge_process_id: 123,
        bridge_started_at: "2026-06-07T21:00:00.000Z"
      },
      suggested_next_action: "retry repo_list_roots in a fresh MCP session"
    });

    const raw = await readFile(join(root, ".chatgpt/events/bridge-events.jsonl"), "utf8");
    const event = JSON.parse(raw.trim()) as Record<string, unknown>;

    expect(event).toMatchObject({
      event_type: "tool_session_terminated",
      repo_id: "fixture",
      severity: "warning",
      summary: expect.stringContaining("Bad Request"),
      evidence: {
        request_id: "req-1",
        mcp_session: "present",
        session_fingerprint: "abc123",
        json_rpc_error_code: -32000,
        bridge_process_id: 123,
        bridge_started_at: "2026-06-07T21:00:00.000Z"
      },
      suggested_next_action: "retry repo_list_roots in a fresh MCP session",
      acknowledgement_policy: expect.stringContaining("explicit acknowledgement")
    });
  });
});
