import { describe, expect, test } from "vitest";
import { CodexAppserverTurnInputSchema, CodexAppserverTurnResultSchema } from "../src/contracts/codex-appserver.contract.js";
import { CodexAppserverTurnService } from "../src/services/codex-appserver-turn-service.js";

describe("CodexAppserverTurnService", () => {
  test("returns dry-run JSON-RPC receipt through the handler service path", async () => {
    const service = new CodexAppserverTurnService("M:/Shared Agent Bridge", async (request, options) => {
      expect(options.dryRun).toBe(true);
      expect(request).toMatchObject({
        repo_id: "shared-agent-bridge",
        workstream: "bridge-mcp",
        target_thread_id: ""
      });
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          status: "dry_run",
          connection_status: "not_attempted",
          proof_boundary: "validated outbound JSON-RPC envelope only; no live Codex app-server reached",
          repo_id: "shared-agent-bridge",
          workstream: "bridge-mcp",
          binding_id: "shared-agent-bridge:bridge-mcp:codex-appserver",
          correlation_id: "test",
          bootstrap_used: true,
          direct_send: false,
          target_thread_id: "",
          jsonrpc_wire_note: "Codex app-server omits the jsonrpc field on the wire.",
          messages: [
            { method: "initialize", id: 0, params: { clientInfo: { name: "test" } } },
            { method: "initialized", params: {} },
            { method: "thread/start", id: 1, params: { cwd: "M:/Shared Agent Bridge", sandbox: "workspaceWrite", approvalPolicy: "never" } },
            { method: "turn/start", id: 2, params: { threadId: "$THREAD_ID_FROM_THREAD_START", input: [{ type: "text", text: "hello" }] } }
          ]
        })
      };
    });

    const result = await service.turn({
      repo_id: "shared-agent-bridge",
      workstream: "bridge-mcp",
      objective: "Prove dry run",
      allowed_paths: ["gpt-repo-mcp/**"],
      forbidden_paths: ["**/.env*"],
      acceptance_criteria: ["receipt"],
      dry_run: true
    });

    expect(CodexAppserverTurnResultSchema.safeParse(result).success).toBe(true);
    expect(result.status).toBe("dry_run");
    expect(result.bootstrap_used).toBe(true);
    expect(result.direct_send).toBe(false);
    expect(result.json_rpc_messages.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "thread/start",
      "turn/start"
    ]);
    expect(JSON.stringify(result)).not.toContain("M:/Shared Agent Bridge");
    expect(result.next_proof_step).toContain("Bootstrap or supply a target_thread_id");
  });

  test("uses stored target thread directly without bootstrap when binding is supplied", async () => {
    const service = new CodexAppserverTurnService("M:/Shared Agent Bridge", async (request) => {
      expect(request.target_thread_id).toBe("thread-bound-1");
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          status: "dry_run",
          connection_status: "not_attempted",
          proof_boundary: "validated outbound JSON-RPC envelope only; no live Codex app-server reached",
          target_thread_id: "thread-bound-1",
          jsonrpc_wire_note: "Codex app-server omits the jsonrpc field on the wire.",
          messages: [
            { method: "initialize", id: 0, params: { clientInfo: { name: "test" } } },
            { method: "initialized", params: {} },
            { method: "turn/start", id: 1, params: { threadId: "thread-bound-1", input: [{ type: "text", text: "follow-up" }] } }
          ]
        })
      };
    });

    const result = await service.turn({
      repo_id: "shared-agent-bridge",
      workstream: "bridge-mcp",
      objective: "Follow up",
      allowed_paths: ["gpt-repo-mcp/**"],
      forbidden_paths: ["**/.env*"],
      acceptance_criteria: ["no bootstrap"],
      dry_run: true,
      target_thread_id: "thread-bound-1"
    });

    expect(result.bootstrap_used).toBe(false);
    expect(result.direct_send).toBe(true);
    expect(result.binding_available).toBe(true);
    expect(result.target_thread_id).toBe("thread-bound-1");
    expect(result.json_rpc_messages.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "turn/start"
    ]);
    expect(result.json_rpc_messages[2]?.params_summary.thread_id).toBe("thread-bound-1");
  });

  test("classifies turn-start acknowledgment followed by status timeout as blocked, not completed", async () => {
    const service = new CodexAppserverTurnService("M:/Shared Agent Bridge", async (request, options) => {
      expect(options.dryRun).toBe(false);
      expect(request.target_thread_id).toBe("thread-bound-1");
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          status: "connected",
          proof_boundary: "direct websocket app-server client; no repo-runner queue used",
          thread_id: "",
          turn_id: "turn-accepted-1",
          events_seen: 5,
          completed: false,
          turn_start_acknowledged: true,
          completion_event: null,
          timeout_phase: "after_thread_status_changed",
          event_shape_tail: [
            { id: 0, method: null, result_keys: ["codexHome", "platformFamily"], error_keys: [], params_keys: [] },
            { id: null, method: "remoteControl/status/changed", result_keys: [], error_keys: [], params_keys: ["environmentId", "installationId", "serverName", "status"] },
            { id: 1, method: null, result_keys: ["turn"], error_keys: [], params_keys: [] },
            { id: null, method: "thread/status/changed", result_keys: [], error_keys: [], params_keys: ["status", "threadId"] },
            { id: null, method: "thread/status/changed", result_keys: [], error_keys: [], params_keys: ["status", "threadId"] }
          ],
          sample_events: []
        })
      };
    });

    const result = await service.turn({
      repo_id: "shared-agent-bridge",
      workstream: "bridge-mcp",
      objective: "Follow up",
      allowed_paths: ["gpt-repo-mcp/**"],
      forbidden_paths: ["**/.env*"],
      acceptance_criteria: ["no false completion"],
      dry_run: false,
      timeout_seconds: 1,
      target_thread_id: "thread-bound-1"
    });

    expect(CodexAppserverTurnResultSchema.safeParse(result).success).toBe(true);
    expect(result.status).toBe("blocked");
    expect(result.live_receipt?.completed).toBe(false);
    expect(result.live_receipt?.turn_start_acknowledged).toBe(true);
    expect(result.live_receipt?.timeout_phase).toBe("after_thread_status_changed");
    expect(result.live_receipt?.event_shape_tail).toHaveLength(5);
    expect(result.next_proof_step).toContain("terminal completion event");
  });

  test("rejects non-loopback WebSocket targets before the client is spawned", async () => {
    let spawned = false;
    const service = new CodexAppserverTurnService("M:/Shared Agent Bridge", async () => {
      spawned = true;
      throw new Error("should not spawn");
    });

    await expect(service.turn({
      repo_id: "shared-agent-bridge",
      objective: "Reject remote",
      allowed_paths: ["gpt-repo-mcp/**"],
      forbidden_paths: ["**/.env*"],
      acceptance_criteria: ["reject"],
      dry_run: true,
      app_server_url: "ws://192.168.1.10:4500"
    })).rejects.toThrow("loopback-only");
    expect(spawned).toBe(false);
  });

  test("input schema defaults to dry-run and loopback app-server URL", () => {
    const parsed = CodexAppserverTurnInputSchema.parse({
      repo_id: "shared-agent-bridge",
      objective: "Defaults",
      allowed_paths: ["gpt-repo-mcp/**"],
      forbidden_paths: ["**/.env*"],
      acceptance_criteria: ["defaults"]
    });

    expect(parsed.dry_run).toBe(true);
    expect(parsed.app_server_url).toBe("ws://127.0.0.1:4500");
    expect(parsed.workstream).toBe("default");
  });
});
