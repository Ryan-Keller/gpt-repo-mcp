import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, beforeEach } from "vitest";
import { RootRegistry } from "../services/root-registry.js";
import { resetConnectorDiagnosticsForTests } from "../runtime/connector-session.js";
import { agentRunnerStatusHandler, listRootsHandler } from "./handlers.js";

describe("concierge preflight stable hub exposure", () => {
  beforeEach(() => {
    resetConnectorDiagnosticsForTests();
  });

  test("repo_runner_status summary includes a compact concierge preflight packet", async () => {
    const root = await createRepoRoot();
    const registry = await createRegistry(root);

    const result = await agentRunnerStatusHandler({ repo_id: "fixture" }, { registry });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      repo_id: "fixture",
      detail_level: "summary",
      capability_summary: {
        concierge_preflight: {
          current_route: "repo_runner_status.capability_summary.concierge_preflight",
          status: "available",
          advisory_only: true,
          fresh_state_receipt: {
            state_source: "repo_runner_status",
            freshness_status: "fresh",
            confidence: "high"
          },
          current_work_summary: {
            counts: {
              active: 0,
              pending: 0,
              blocked: 0,
              ready_results: 0
            }
          },
          recommended_route: {
            primary_tool: "repo_bridge_concierge",
            fallback_tool: "repo_runner_status",
            mobile_fallback: "repo_list_roots.runner_status"
          },
          mutation_capability: {
            can_dispatch_codex: false,
            can_clear_locks: false,
            can_write_files: false,
            can_override_fresh_state: false
          }
        }
      }
    });

    const serialized = JSON.stringify(result.structuredContent);
    expect(serialized).not.toContain("safe_operations");
    expect(serialized).not.toContain("safe_actions");
    expect(serialized).not.toContain("source_path");
  });

  test("repo_list_roots summary exposes the same compact concierge preflight packet", async () => {
    const root = await createRepoRoot();
    const registry = await createRegistry(root);

    const result = await listRootsHandler({}, { registry });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      repos: [
        {
          repo_id: "fixture",
          capability_summary: {
            concierge_preflight: {
              current_route: "repo_runner_status.capability_summary.concierge_preflight",
              status: "available",
              advisory_only: true,
              recommended_route: {
                primary_tool: "repo_bridge_concierge",
                fallback_tool: "repo_runner_status",
                mobile_fallback: "repo_list_roots.runner_status"
              }
            }
          }
        }
      ]
    });
  });
});

async function createRegistry(root: string): Promise<RootRegistry> {
  return RootRegistry.fromConfig({
    repos: [{
      repo_id: "fixture",
      display_name: "Fixture Repo",
      root,
      writes: { enabled: true, allowed_globs: ["docs/**", "src/**", ".chatgpt/**"] },
      operations: {
        enabled: true,
        git_stage_enabled: true,
        git_commit_enabled: true,
        cleanup_enabled: true
      }
    }],
    limits: {}
  });
}

async function createRepoRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gpt-repo-mcp-concierge-preflight-"));
  await mkdir(join(root, "projects", "agent-runner", "reports"), { recursive: true });
  await mkdir(join(root, "shared", "capabilities"), { recursive: true });
  await writeFile(join(root, "projects", "agent-runner", "reports", "runner-heartbeat.json"), JSON.stringify({
    updated_at: new Date().toISOString(),
    status: "running",
    active_run_id: "",
    active_run_ids: [],
    runner_pid: process.pid,
    max_parallel_runs: 1,
    worker_slots: [{
      slot_id: 1,
      state: "idle",
      run_id: "",
      progress: {}
    }]
  }));
  await writeFile(join(root, "shared", "capabilities", "BRIDGE_CAPABILITY_TOC_V0.json"), JSON.stringify({
    generated_at: "2026-06-13T20:00:00Z",
    capabilities: [
      {
        capability_id: "concierge_style_routing",
        status: "implemented_read_only",
        summary: "Destination-first route lookup plus a read-only concierge preflight packet.",
        existing_tool_or_hub_route: "repo_runner_status.capability_summary.concierge_preflight; repo_bridge_concierge",
        docs_protocol_refs: ["shared/protocols/FRESH_STATE_PREFLIGHT_V0.md"],
        safe_operations: ["read_only_preflight_packet"],
        blocked_operations: ["queue_work_without_dispatch_preflight"],
        suggested_next_action: "Use the stable hub packet before broad routing decisions."
      }
    ]
  }));
  await writeFile(join(root, "shared", "capabilities", "BRIDGE_MODULE_REGISTRY_V0.json"), JSON.stringify({
    generated_at: "2026-06-13T20:00:00Z",
    modules: [
      {
        module_id: "concierge_style_routing",
        status: "implemented_read_only",
        class: "protocol_backed",
        summary: "Read-only destination routing and preflight.",
        source_refs: ["projects/agent-runner/agent_runner.py"],
        groups_capabilities: ["concierge_style_routing"],
        public_surface: "repo_runner_status.capability_summary.concierge_preflight",
        safe_actions: ["inspect_status"],
        blocked_actions: ["push"]
      }
    ]
  }));
  return root;
}
