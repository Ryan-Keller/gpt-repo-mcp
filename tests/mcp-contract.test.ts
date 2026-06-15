import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { SERVER_INSTRUCTIONS, createMcpServer } from "../src/register.js";
import { RootRegistry } from "../src/services/root-registry.js";
import { readOnlyAnnotations, writeAnnotations } from "../src/tools/annotations.js";
import { toolCatalog } from "../src/tools/catalog.js";
import { isMutatingToolName } from "../src/tools/mutating-tools.js";

const execFileAsync = promisify(execFile);
function firstContent(result: unknown): unknown {
  const record = typeof result === "object" && result !== null ? result as { content?: unknown } : {};
  return Array.isArray(record.content) ? record.content[0] : undefined;
}

describe("MCP contract", () => {
  test("initialize exposes server instructions and tool capability", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      expect(client.getServerVersion()).toMatchObject({ name: "gpt-repo-mcp", version: "0.1.0" });
      expect(client.getServerCapabilities()).toMatchObject({ tools: {} });
      expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
      expect(SERVER_INSTRUCTIONS).not.toContain("read-only repository app");
      expect(SERVER_INSTRUCTIONS).toContain("Mutating tools are disabled by default and require repo-local config opt-in");
      expect(SERVER_INSTRUCTIONS).toContain("Prefer the repo_write_* names for ChatGPT workflows");
      expect(SERVER_INSTRUCTIONS).toContain("repo_write_commit, repo_write_stage_commit, and repo_git_commit create local commits only");
      expect(SERVER_INSTRUCTIONS).toContain("repo_git_review is the workflow hub");
      expect(SERVER_INSTRUCTIONS).toContain("prefer composite workflow tools");
      expect(SERVER_INSTRUCTIONS).toContain("repo_write_stage_commit for reviewed happy-path local commits");
      expect(SERVER_INSTRUCTIONS).toContain("repo_write_recover for reviewed recovery");
      expect(SERVER_INSTRUCTIONS).toContain("Dry-run is optional preview");
      expect(SERVER_INSTRUCTIONS).toContain("Omit optional reason by default");
      expect(SERVER_INSTRUCTIONS).toContain("repo_last_write");
      expect(SERVER_INSTRUCTIONS).not.toContain("dry-run first when possible");
      expect(SERVER_INSTRUCTIONS).toContain("do not push");
      expect(SERVER_INSTRUCTIONS).toContain("do not run shell commands");
    } finally {
      await close();
    }
  });

  test("tools/list exposes schemas and appropriate annotations for every tool", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const listed = await client.listTools();
      expect(new Set(listed.tools.map((tool) => tool.name))).toEqual(new Set(toolCatalog.map((tool) => tool.name)));

      for (const tool of listed.tools) {
        expect(tool.title).toEqual(expect.any(String));
        expect(tool.description).toEqual(expect.stringMatching(/^Use this when/));
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
        if (isMutatingToolName(tool.name)) {
          expect(tool.annotations).toMatchObject(writeAnnotations);
        } else {
          expect(tool.annotations).toMatchObject(readOnlyAnnotations);
        }
      }
    } finally {
      await close();
    }
  });

  test("tools/list exposed surface stays stable", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const listed = await client.listTools();
      const surface = listed.tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        annotations: tool.annotations,
        inputKeys: Object.keys(tool.inputSchema.properties ?? {}).sort(),
        outputKeys: Object.keys(tool.outputSchema?.properties ?? {}).sort()
      }));
      const names = surface.map((tool) => tool.name);
      const labExec = surface.find((tool) => tool.name === "repo_lab_exec");
      const liveTail = surface.find((tool) => tool.name === "repo_run_live_tail");
      const runnerStatus = surface.find((tool) => tool.name === "repo_runner_status");

      expect(names).toHaveLength(42);
      expect(names).toContain("repo_bridge_concierge");
      expect(names).toContain("repo_run_live_tail");
      expect(names).toContain("repo_runner_status");
      expect(names).toContain("repo_connector_whoami");
      expect(names).toContain("repo_project_memory");
      expect(names).toContain("repo_write_codex_tasks_batch");
      expect(names).toContain("repo_lab_exec");
      expect(names).toContain("repo_town_portal_return");
      expect(names).toContain("agent_runner_status");
      expect(labExec).toMatchObject({
        title: "Run guarded lab file",
        inputKeys: ["command", "max_output_bytes", "repo_id", "timeout_seconds"],
        outputKeys: [
          "allowed",
          "argv",
          "cwd_label",
          "duration_ms",
          "exit_code",
          "ok",
          "output_sha256",
          "policy",
          "repo_id",
          "signal",
          "spawned",
          "status",
          "stderr_tail",
          "stderr_truncated",
          "stdout_tail",
          "stdout_truncated",
          "timed_out",
          "warnings"
        ]
      });
      expect(runnerStatus?.inputKeys).toEqual([
        "capability_id",
        "detail",
        "heartbeat_stale_seconds",
        "live_tail_max_events",
        "poll_count",
        "poll_interval_seconds",
        "portal_id",
        "repo_id",
        "stale_lock_seconds"
      ]);
      expect(runnerStatus?.outputKeys).toEqual([
        "active_count",
        "active_run_id",
        "active_run_ids",
        "blocked_count",
        "capability_summary",
        "completed_count",
        "detail_level",
        "details_truncated",
        "full_detail_hint",
        "ok",
        "pending_count",
        "plain_text",
        "ready_results",
        "repo_id",
        "runner",
        "runtime_assessment",
        "stale_lock_count",
        "warnings",
        "worker"
      ]);
      const runnerStatusSchema = JSON.stringify(listed.tools.find((tool) => tool.name === "repo_runner_status")?.outputSchema);
      expect(runnerStatusSchema).not.toContain("result_text");
      expect(runnerStatusSchema).not.toContain("worker_slots");
      expect(runnerStatusSchema).not.toContain("active_run_live_tail");
      expect(runnerStatusSchema).not.toContain("poll_history");
      expect(runnerStatusSchema.length).toBeLessThan(8_500);
      expect(liveTail).toMatchObject({
        title: "Show Codex run live tail",
        inputKeys: ["cursor", "max_events", "repo_id", "run_id"],
        outputKeys: [
          "events",
          "next_cursor",
          "ok",
          "repo_id",
          "result_path",
          "result_status",
          "run_id",
          "terminal",
          "warnings"
        ]
      });
    } finally {
      await close();
    }
  });

  test("tools/call returns structuredContent matching the advertised output", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const result = await client.callTool({
        name: "repo_list_roots",
        arguments: {}
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        repos: [
          expect.objectContaining({
            repo_id: "fixture",
            display_name: "Fixture Repo",
            root: expect.any(String)
          })
        ],
        bridge_observability: expect.objectContaining({
          transport_type: "streamable_http",
          suggested_next_action: expect.any(String),
          connector_identity: expect.objectContaining({
            auth_mode: expect.any(String),
            server_catalog_has_repo_connector_whoami: true,
            callable_surface_warning: expect.stringContaining("repo_connector_whoami")
          })
        })
      });
      expect(firstContent(result)).toMatchObject({
        type: "text",
        text: expect.stringContaining("1 approved repositories available.")
      });
      expect(firstContent(result)).toMatchObject({
        type: "text",
        text: expect.stringContaining("Runner:")
      });
    } finally {
      await close();
    }
  });

  test("repo_list_roots includes read-only runner status fallback for mobile ChatGPT", async () => {
    const { client, root, close } = await connectFixtureServer();
    try {
      await mkdir(join(root, "projects", "agent-runner", "reports"), { recursive: true });
      await writeFile(join(root, "projects", "agent-runner", "reports", "runner-heartbeat.json"), JSON.stringify({
        updated_at: new Date().toISOString(),
        status: "running",
        active_run_id: "",
        runner_pid: process.pid
      }));

      const result = await client.callTool({
        name: "repo_list_roots",
        arguments: {}
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        repos: [
          {
            repo_id: "fixture",
            runner_status: {
              ok: true,
              repo_id: "fixture",
              runner: "alive",
              worker: "running"
            }
          }
        ]
      });
      expect(firstContent(result)).toMatchObject({
        type: "text",
        text: expect.stringContaining("Runner:")
      });
    } finally {
      await close();
    }
  });

  test("repo_run_live_tail is read-only and returns safe run events", async () => {
    const { client, root, close } = await connectFixtureServer();
    const runId = "2026-06-07T120000Z-live-tail-contract";
    const runDir = join(root, ".chatgpt", "codex-runs", runId);
    try {
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, "PROMPT.md"), "# Prompt\n");
      await writeFile(join(runDir, "run.json"), JSON.stringify({
        schema_version: 1,
        repo_id: "fixture",
        run_id: runId,
        prompt_path: `.chatgpt/codex-runs/${runId}/PROMPT.md`,
        result_path: `.chatgpt/codex-runs/${runId}/RESULT.md`
      }));
      await writeFile(join(runDir, "events.jsonl"), `${JSON.stringify({
        timestamp: "2026-06-07T12:00:00Z",
        event_type: "run_claimed",
        summary: "Run claimed with token=abc123"
      })}\n`);
      const before = (await readdir(runDir)).sort();

      const result = await client.callTool({
        name: "repo_run_live_tail",
        arguments: {
          repo_id: "fixture",
          run_id: runId
        }
      });

      const after = (await readdir(runDir)).sort();
      expect(result.isError).toBeUndefined();
      expect(after).toEqual(before);
      expect(result.structuredContent).toMatchObject({
        ok: true,
        repo_id: "fixture",
        run_id: runId,
        terminal: false,
        events: [
          expect.objectContaining({
            event_type: "run_claimed",
            summary: expect.stringContaining("token=[REDACTED]")
          })
        ]
      });
      expect(JSON.stringify(result.structuredContent)).not.toContain("abc123");
    } finally {
      await close();
    }
  });

  test("repo_list_roots includes compact vision discovery and existing-tool helper fallback", async () => {
    const { client, root, close } = await connectFixtureServer();
    try {
      await writeCapabilityToc(root);
      const result = await client.callTool({
        name: "repo_list_roots",
        arguments: {}
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        bridge_observability: {
          bridge_process_id: expect.any(Number),
          bridge_started_at: expect.any(String),
          bridge_uptime_seconds: expect.any(Number),
          tool_catalog_generation: expect.any(String),
          tool_catalog_loaded_at: expect.any(String),
          request_observed_at: expect.any(String),
          request_id: expect.any(String),
          session_fingerprint: expect.any(String),
          transport_type: "streamable_http",
          last_successful_tool_call_at: expect.any(String),
          last_tool_error: expect.any(String),
          last_tool_error_code: null,
          last_tool_error_message: expect.any(String),
          last_tool_error_observed_at: expect.any(String),
          suspected_failure_layer: expect.any(String),
          suggested_next_action: expect.any(String),
          connector_identity: expect.objectContaining({
            auth_mode: expect.any(String),
            chatgpt_callable_surface_verified: false,
            server_catalog_has_repo_connector_whoami: true
          })
        },
        repos: [
          {
            repo_id: "fixture",
            bridge_observability: {
              bridge_process_id: expect.any(Number),
              tool_catalog_generation: expect.any(String),
              suspected_failure_layer: expect.any(String)
            },
            vision_capabilities: {
              has_configured_vision_route: expect.any(Boolean),
              route_status: expect.stringMatching(/^(ready|blocked)$/),
              missing_capabilities: expect.any(Array),
              helper: {
                tool: "repo_write_codex_task",
                input_assets_required: true,
                result_visibility: "repo_list_roots.ready_results",
                route_status: expect.stringMatching(/^(ready|blocked)$/)
              }
            },
            capability_summary: {
              expansion: {
                mode: "skeletal",
                focused: false
              },
              bridge_compass: {
                current_route: "repo_runner_status.capability_summary.bridge_compass",
                runner_state: {
                  runner: expect.any(String),
                  worker: expect.any(String),
                  runtime_assessment: expect.any(String),
                  pending_count: expect.any(Number),
                  active_count: expect.any(Number),
                  stale_lock_count: expect.any(Number)
                },
                active_lane: {
                  state: expect.stringMatching(/^(active|queued|ready_result_review|idle|blocked)$/),
                  run_id: expect.any(String),
                  lane: expect.any(String)
                },
                top_blocker: {
                  status: expect.stringMatching(/^(none|blocked)$/),
                  source: expect.any(String),
                  summary: expect.any(String)
                },
                module_handles: [
                  {
                    module_id: "save_crystal",
                    status: "documented_draft",
                    class: "protocol_backed"
                  },
                  {
                    module_id: "town_portal",
                    status: "documented_experimental",
                    class: "validator_needed"
                  }
                ],
                proof_layer: expect.stringMatching(/^(source-tested|local-live|blocked|unknown)$/),
                next_safe_action: expect.any(String),
                context_budget_hint: expect.stringContaining("Use bridge_compass first")
              },
              capability_toc: {
                state: "available",
                capability_count: 1,
                returned_count: 1,
                capabilities: [
                  expect.objectContaining({
                    capability_id: "town_portal",
                    status: "documented_experimental"
                  })
                ]
              },
              module_registry: {
                state: "available",
                module_count: 2,
                returned_count: 2,
                modules: [
                  {
                    module_id: "save_crystal",
                    status: "documented_draft",
                    class: "protocol_backed"
                  },
                  {
                    module_id: "town_portal",
                    status: "documented_experimental",
                    class: "validator_needed"
                  }
                ]
              },
              states: {
                codex_handoff: "available",
                runner: expect.stringMatching(/^(available|unavailable|unknown|blocked)$/),
                image_assets: "available",
                vision_route_detection: "available"
              }
            }
          }
        ]
      });
      const serialized = JSON.stringify(result.structuredContent);
      expect(serialized).not.toContain("content_base64");
      expect(serialized).not.toContain("completed_result_template");
      expect(serialized).not.toContain("safe_operations");
      expect(serialized).not.toContain("safe_actions");
      expect(serialized).not.toContain("source_path");
      expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
      expect(serialized.length).toBeLessThan(22_000);
      expect(firstContent(result)).toMatchObject({
        type: "text",
        text: expect.stringContaining("Detail: summary; request detail: \"full\"")
      });
      expect(firstContent(result)).toMatchObject({
        type: "text",
        text: expect.stringContaining("Capabilities: toc=available")
      });
      expect(firstContent(result)).toMatchObject({
        type: "text",
        text: expect.stringContaining("Bridge compass:")
      });
    } finally {
      await close();
    }
  });

  test("repo_list_roots expands runner, capability, and vision diagnostics with detail full", async () => {
    const { client, root, close } = await connectFixtureServer();
    try {
      await writeCapabilityToc(root);
      const result = await client.callTool({
        name: "repo_list_roots",
        arguments: { detail: "full" }
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        repos: [
          {
            runner_status: {
              detail_level: "full",
              details_truncated: false
            },
            vision_capabilities: {
              available_routes: expect.any(Array),
              helper: {
                completed_result_template: expect.any(String),
                blocked_result_template: expect.any(String)
              }
            },
            capability_summary: {
              expansion: {
                mode: "full"
              },
              capability_toc: {
                capabilities: [
                  expect.objectContaining({
                    capability_id: "town_portal",
                    safe_operations: ["display_only_knowledge_record"]
                  })
                ]
              },
              module_registry: {
                modules: expect.arrayContaining([
                  expect.objectContaining({
                    module_id: "save_crystal",
                    safe_actions: ["inspect_status"]
                  })
                ])
              },
              codex_handoff: {
                evidence: expect.any(Array),
                safe_operations: expect.any(Array)
              }
            }
          }
        ]
      });
    } finally {
      await close();
    }
  });

  test("repo_list_roots expands one exact capability without returning the full catalog", async () => {
    const { client, root, close } = await connectFixtureServer();
    try {
      await writeCapabilityToc(root);
      await writeFile(join(root, "shared", "capabilities", "BRIDGE_CAPABILITY_TOC_V0.json"), JSON.stringify({
        generated_at: "2026-06-12T08:46:28Z",
        capabilities: [
          {
            capability_id: "town_portal",
            status: "documented_experimental",
            summary: "Single-use continuation handle.",
            existing_tool_or_hub_route: "repo_runner_status.capability_summary.capability_toc",
            docs_protocol_refs: ["shared/protocols/TOWN_PORTAL_PRIMITIVE_V0.md"],
            safe_operations: ["display_only_knowledge_record"],
            blocked_operations: ["queue_codex_runs"],
            suggested_next_action: "Implement read-only hub summary first."
          },
          {
            capability_id: "atlas_lookup",
            status: "implemented_read_only",
            summary: "Read-only atlas lookup.",
            existing_tool_or_hub_route: "repo_bridge_concierge evidence",
            docs_protocol_refs: ["docs/openclaw/CONCEPT_ATLAS_GRAPH_V0.json"],
            safe_operations: ["read_graph_nodes"],
            blocked_operations: ["rewrite_atlas_graph"],
            suggested_next_action: "Use concierge evidence first."
          }
        ]
      }));

      const skeletal = await client.callTool({
        name: "repo_list_roots",
        arguments: {}
      });
      const focused = await client.callTool({
        name: "repo_list_roots",
        arguments: { capability_id: "atlas_lookup" }
      });
      const full = await client.callTool({
        name: "repo_list_roots",
        arguments: { detail: "full" }
      });

      expect(focused.isError).toBeUndefined();
      expect(focused.structuredContent).toMatchObject({
        repos: [
          {
            capability_summary: {
              expansion: {
                mode: "focused",
                capability_id: "atlas_lookup",
                found: true
              },
              capability_toc: {
                capability_count: 2,
                returned_count: 1,
                capabilities: [
                  expect.objectContaining({
                    capability_id: "atlas_lookup",
                    safe_operations: ["read_graph_nodes"]
                  })
                ]
              }
            }
          }
        ]
      });
      const focusedJson = JSON.stringify(focused.structuredContent);
      const skeletalJson = JSON.stringify(skeletal.structuredContent);
      const fullJson = JSON.stringify(full.structuredContent);
      const focusedContent = focused.structuredContent as {
        repos: Array<{
          capability_summary: {
            capability_toc: {
              capabilities: Array<{ capability_id: string }>;
            };
          };
        }>;
      };
      expect(focusedContent.repos[0]?.capability_summary.capability_toc.capabilities).toHaveLength(1);
      expect(focusedContent.repos[0]?.capability_summary.capability_toc.capabilities[0]?.capability_id).toBe("atlas_lookup");
      expect(focusedJson).not.toContain("safe_actions");
      expect(skeletalJson).not.toContain("safe_operations");
      expect(skeletalJson.length).toBeLessThan(22_000);
      expect(skeletalJson.length).toBeLessThan(fullJson.length);
      expect(focusedJson.length).toBeLessThan(fullJson.length);
    } finally {
      await close();
    }
  });

  test("repo_list_roots exposes read-only town_portal inbox groups and selected portal hydration", async () => {
    const { client, root, close } = await connectFixtureServer();
    try {
      await writeCapabilityToc(root);
      await writePortalFixtures(root);

      const result = await client.callTool({
        name: "repo_list_roots",
        arguments: {
          capability_id: "town_portal",
          portal_id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d"
        }
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        repos: [
          {
            capability_summary: {
              expansion: {
                mode: "focused",
                capability_id: "town_portal",
                found: true
              },
              town_portal_surface: {
                surface: "read_only_portal_inbox_v0",
                counts: {
                  total_portals: 3,
                  selected_receipt_count: 1
                },
                selection: {
                  portal_id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
                  found: true
                },
                status_groups: [
                  expect.objectContaining({ status: "active", count: 1 }),
                  expect.objectContaining({ status: "returned", count: 1 }),
                  expect.objectContaining({ status: "consumed", count: 1 })
                ],
                selected_portal: {
                  id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
                  status: "returned"
                },
                receipts: [
                  expect.objectContaining({
                    to_status: "returned",
                    summary: "Fresh chat returned a bounded recovery card and is waiting for accept or park."
                  })
                ]
              }
            }
          }
        ]
      });
    } finally {
      await close();
    }
  });

  test("repo_runner_status includes capability_toc through existing status hub", async () => {
    const { client, root, close } = await connectFixtureServer();
    try {
      await writeCapabilityToc(root);
      const result = await client.callTool({
        name: "repo_runner_status",
        arguments: { repo_id: "fixture" }
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        repo_id: "fixture",
        detail_level: "summary",
        details_truncated: true,
        runner: expect.any(String),
        worker: expect.any(String),
        runtime_assessment: expect.any(String),
        active_count: expect.any(Number),
        pending_count: expect.any(Number),
        stale_lock_count: expect.any(Number),
        completed_count: expect.any(Number),
        blocked_count: expect.any(Number),
        active_run_ids: expect.any(Array),
        ready_results: expect.any(Array),
        warnings: expect.any(Array),
        plain_text: expect.stringContaining("Detail: summary; request detail: \"full\""),
        capability_summary: {
          expansion: {
            mode: "skeletal",
            focused: false
          },
          bridge_compass: {
            current_route: "repo_runner_status.capability_summary.bridge_compass",
            runner_state: {
              runner: expect.any(String),
              worker: expect.any(String),
              runtime_assessment: expect.any(String),
              pending_count: expect.any(Number),
              active_count: expect.any(Number),
              stale_lock_count: expect.any(Number)
            },
            active_lane: {
              state: expect.stringMatching(/^(active|queued|ready_result_review|idle|blocked)$/),
              run_id: expect.any(String),
              lane: expect.any(String)
            },
            top_blocker: {
              status: expect.stringMatching(/^(none|blocked)$/),
              source: expect.any(String),
              summary: expect.any(String)
            },
            module_handles: [
              {
                module_id: "save_crystal",
                status: "documented_draft",
                class: "protocol_backed"
              },
              {
                module_id: "town_portal",
                status: "documented_experimental",
                class: "validator_needed"
              }
            ],
            proof_layer: expect.stringMatching(/^(source-tested|local-live|blocked|unknown)$/),
            next_safe_action: expect.any(String),
            context_budget_hint: expect.stringContaining("Use bridge_compass first")
          },
          capability_toc: {
            state: "available",
            capability_count: 1,
            capabilities: [
              expect.objectContaining({
                capability_id: "town_portal",
                status: "documented_experimental"
              })
            ]
          },
          module_registry: {
            state: "available",
            module_count: 2,
            modules: [
              {
                module_id: "save_crystal",
                status: "documented_draft",
                class: "protocol_backed"
              },
              {
                module_id: "town_portal",
                status: "documented_experimental",
                class: "validator_needed"
              }
            ]
          }
        }
      });
      const serialized = JSON.stringify(result.structuredContent);
      expect(serialized).not.toContain("connector_identity");
      expect(serialized).not.toContain("safe_operations");
      expect(serialized).not.toContain("safe_actions");
      expect(serialized).not.toContain("next_action_hints");
      expect(serialized).not.toContain("source_path");
      expect(serialized.length).toBeLessThan(8_000);
      expect(result.structuredContent).not.toHaveProperty("worker_slots");
      expect(result.structuredContent).not.toHaveProperty("active_locks");
      expect(result.structuredContent).not.toHaveProperty("stale_locks");
      expect(result.structuredContent).not.toHaveProperty("queue_entries");
      expect(result.structuredContent).not.toHaveProperty("recent_events");
      expect(result.structuredContent).not.toHaveProperty("unresolved_events");
      expect(result.structuredContent).not.toHaveProperty("active_run_live_tail");
    } finally {
      await close();
    }
  });

  test("repo_runner_status expands capability_toc detail with detail full", async () => {
    const { client, root, close } = await connectFixtureServer();
    try {
      await writeCapabilityToc(root);
      const result = await client.callTool({
        name: "repo_runner_status",
        arguments: { repo_id: "fixture", detail: "full" }
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        repo_id: "fixture",
        detail_level: "full",
        details_truncated: false,
        capability_summary: {
          expansion: {
            mode: "full"
          },
          bridge_compass: {
            current_route: "repo_runner_status.capability_summary.bridge_compass",
            module_handles: expect.arrayContaining([
              expect.objectContaining({ module_id: "town_portal" })
            ]),
            proof_layer: expect.stringMatching(/^(source-tested|local-live|blocked|unknown)$/),
            next_safe_action: expect.any(String)
          },
          capability_toc: {
            capabilities: [
              expect.objectContaining({
                capability_id: "town_portal",
                safe_operations: ["display_only_knowledge_record"]
              })
            ]
          },
          module_registry: {
            modules: expect.arrayContaining([
              expect.objectContaining({
                module_id: "town_portal",
                safe_actions: ["display_only_knowledge_record"]
              })
            ])
          }
        }
      });
    } finally {
      await close();
    }
  });

  test("repo_runner_status expands one exact capability by id", async () => {
    const { client, root, close } = await connectFixtureServer();
    try {
      await writeCapabilityToc(root);
      const result = await client.callTool({
        name: "repo_runner_status",
        arguments: { repo_id: "fixture", capability_id: "town_portal" }
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        repo_id: "fixture",
        detail_level: "summary",
        capability_summary: {
          expansion: {
            mode: "focused",
            capability_id: "town_portal",
            found: true
          },
          capability_toc: {
            returned_count: 1,
            capabilities: [
              expect.objectContaining({
                capability_id: "town_portal",
                docs_protocol_refs: ["shared/protocols/TOWN_PORTAL_PRIMITIVE_V0.md"],
                safe_operations: ["display_only_knowledge_record"]
              })
            ]
          }
        }
      });
      const serialized = JSON.stringify(result.structuredContent);
      expect(serialized).toContain("safe_operations");
      expect(serialized).not.toContain("completed_result_template");
      expect(serialized.length).toBeLessThan(8_000);
    } finally {
      await close();
    }
  });

  test("repo_runner_status exposes read-only town_portal inbox groups and selected portal hydration", async () => {
    const { client, root, close } = await connectFixtureServer();
    try {
      await writeCapabilityToc(root);
      await writePortalFixtures(root);

      const result = await client.callTool({
        name: "repo_runner_status",
        arguments: {
          repo_id: "fixture",
          capability_id: "town_portal",
          portal_id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d"
        }
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        repo_id: "fixture",
        detail_level: "summary",
        capability_summary: {
          expansion: {
            mode: "focused",
            capability_id: "town_portal",
            found: true
          },
          town_portal_surface: {
            surface: "read_only_portal_inbox_v0",
            counts: {
              total_portals: 3,
              status_groups: 3,
              selected_receipt_count: 1
            },
            selection: {
              portal_id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
              found: true
            },
            status_groups: [
              expect.objectContaining({ status: "active", count: 1 }),
              expect.objectContaining({ status: "returned", count: 1 }),
              expect.objectContaining({ status: "consumed", count: 1 })
            ],
            selected_portal: {
              id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
              latest_receipt_path: "shared/portals/receipts/portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d/2026-06-13T16-42-00.000Z-returned.json"
            },
            receipts: [
              expect.objectContaining({
                receipt_path: "shared/portals/receipts/portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d/2026-06-13T16-42-00.000Z-returned.json",
                to_status: "returned"
              })
            ],
            warnings: []
          }
        }
      });
      const serialized = JSON.stringify(result.structuredContent);
      expect(serialized).not.toContain("result_text");
      expect(serialized).not.toContain("current_state_hash");
    } finally {
      await close();
    }
  });

  test("repo_runner_status exposes compact ready result cards without result text by default", async () => {
    const { client, root, close } = await connectFixtureServer();
    const completedId = "2026-06-13T020100Z-compact-ready-card";
    const blockedId = "2026-06-13T020200Z-blocked-ready-card";
    try {
      for (const runId of [completedId, blockedId]) {
        const runDir = join(root, ".chatgpt", "codex-runs", runId);
        await mkdir(runDir, { recursive: true });
        await writeFile(join(runDir, "PROMPT.md"), "# Prompt\n");
        await writeFile(join(runDir, "run.json"), JSON.stringify({
          schema_version: 1,
          repo_id: "fixture",
          run_id: runId,
          prompt_path: `.chatgpt/codex-runs/${runId}/PROMPT.md`,
          result_path: `.chatgpt/codex-runs/${runId}/RESULT.md`
        }));
      }
      await writeFile(join(root, ".chatgpt", "codex-runs", completedId, "RESULT.md"), [
        "# CODEX_RESULT",
        "status: completed",
        "summary: Added compact ready result cards.",
        "changed_files:",
        "- projects/agent-runner/agent_runner.py",
        "- gpt-repo-mcp/src/services/agent-runner-status-service.ts",
        "tests:",
        "- PASS: python -m pytest projects/agent-runner/tests/test_agent_runner.py -q -k result",
        "- PASS: npm test -- tests/mcp-contract.test.ts",
        "blockers:",
        "- None",
        "followups:",
        "- Restart GPT Repo MCP before claiming live ChatGPT visibility.",
        "proof_layer: source-tested",
        ""
      ].join("\n"));
      await writeFile(join(root, ".chatgpt", "codex-runs", blockedId, "RESULT.md"), [
        "# CODEX_RESULT",
        "status: blocked",
        "summary: Could not prove actual model output.",
        "changed_files:",
        "- shared/status/model-proof.md",
        "tests:",
        "- PASS: deterministic fallback refreshed",
        "blockers:",
        "- Actual model output artifact is missing.",
        "followups:",
        "- Run guarded model proof once output route is fixed.",
        ""
      ].join("\n"));

      const result = await client.callTool({
        name: "repo_runner_status",
        arguments: { repo_id: "fixture" }
      });

      expect(result.isError).toBeUndefined();
      const content = result.structuredContent as {
        ready_results: Array<Record<string, unknown>>;
      };
      const cards = new Map(content.ready_results.map((card) => [card.run_id, card]));
      expect(cards.get(completedId)).toMatchObject({
        run_id: completedId,
        status: "completed",
        result_status: "completed",
        summary: "Added compact ready result cards.",
        changed_file_count: 2,
        key_tests: [
          "PASS: python -m pytest projects/agent-runner/tests/test_agent_runner.py -q -k result",
          "PASS: npm test -- tests/mcp-contract.test.ts"
        ],
        blocker: "",
        proof_layer: "source-tested",
        next_action: "Restart GPT Repo MCP before claiming live ChatGPT visibility."
      });
      expect(cards.get(blockedId)).toMatchObject({
        run_id: blockedId,
        status: "blocked",
        blocker: "Actual model output artifact is missing.",
        proof_layer: "blocked",
        next_action: "Run guarded model proof once output route is fixed."
      });
      expect(JSON.stringify(result.structuredContent)).not.toContain("result_text");
    } finally {
      await close();
    }
  });

  test("repo_git_status includes read-only runner status fallback for cached ChatGPT connectors", async () => {
    const { client, root, close } = await connectFixtureServer();
    try {
      await mkdir(join(root, "projects", "agent-runner", "reports"), { recursive: true });
      await writeFile(join(root, "projects", "agent-runner", "reports", "runner-heartbeat.json"), JSON.stringify({
        updated_at: new Date().toISOString(),
        status: "running",
        active_run_id: "",
        runner_pid: process.pid
      }));

      const result = await client.callTool({
        name: "repo_git_status",
        arguments: { repo_id: "fixture" }
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        clean: expect.any(Boolean),
        runner_status: {
          ok: true,
          repo_id: "fixture",
          runner: "alive",
          worker: "running",
          active_count: 0
        }
      });
      expect(firstContent(result)).toMatchObject({
        type: "text",
        text: expect.stringContaining("Runner:")
      });
    } finally {
      await close();
    }
  });

  test("repo_write_changes partial failure exposes safe diagnostics in error envelope", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const result = await client.callTool({
        name: "repo_write_changes",
        arguments: {
          repo_id: "fixture",
          changes: [
            { type: "write", path: "docs/applied-a.md", content: "A\n" },
            { type: "append", path: "docs/ARCHITECTURE.md", content: "Applied\n" },
            { type: "replace", path: "src/app.ts", find: "missingNeedle", replace: "safeFetch" }
          ]
        }
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: {
          code: "WRITE_FIND_NOT_FOUND",
          retryable: false,
          diagnostics: {
            applied_paths: ["docs/applied-a.md", "docs/ARCHITECTURE.md"],
            failed_path: "src/app.ts",
            recovery_hint: expect.stringContaining("repo_git_review")
          }
        }
      });
      const serialized = JSON.stringify(result.structuredContent);
      expect(serialized).not.toContain("/Users/");
      expect(serialized).not.toContain("A\\n");
      expect(serialized).not.toContain("Applied\\n");
    } finally {
      await close();
    }
  });

  test("repo_last_write returns missing receipt when no write receipt exists", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const result = await client.callTool({
        name: "repo_last_write",
        arguments: { repo_id: "fixture" }
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        ok: true,
        found: false,
        next_tool_payloads: {},
        warnings: ["NO_LAST_WRITE_RECEIPT"]
      });
    } finally {
      await close();
    }
  });

  test("actual repo_write_file creates last write receipt", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const write = await client.callTool({
        name: "repo_write_file",
        arguments: {
          repo_id: "fixture",
          path: "docs/write-file-actual.md",
          content: "actual\n"
        }
      });
      expect(write.isError).toBeUndefined();
      expect(write.structuredContent).toMatchObject({
        operation_receipt: {
          operation_id: expect.stringMatching(/^write-/),
          path: ".chatgpt/operations/last-write.json"
        }
      });

      const result = await client.callTool({
        name: "repo_last_write",
        arguments: { repo_id: "fixture" }
      });

      expect(result.structuredContent).toMatchObject({
        ok: true,
        found: true,
        receipt: {
          tool: "repo_write_file",
          repo_id: "fixture",
          touched_paths: ["docs/write-file-actual.md"],
          changed_paths: ["docs/write-file-actual.md"],
          created_paths: ["docs/write-file-actual.md"],
          modified_paths: [],
          counts: { requested: 1, changed: 1, created: 1, unchanged: 0 },
          summary: "Created docs/write-file-actual.md."
        },
        next_tool_payloads: {
          repo_git_review: { repo_id: "fixture" }
        },
        warnings: []
      });
      const serialized = JSON.stringify(result.structuredContent);
      expect(serialized).not.toContain("actual\\n");
      expect(serialized).not.toContain("/tmp/");
    } finally {
      await close();
    }
  });

  test("repo_write_changes creates receipt and dry-run failed and no-op writes do not overwrite it", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const writeChanges = await client.callTool({
        name: "repo_write_changes",
        arguments: {
          repo_id: "fixture",
          changes: [
            { type: "write", path: "docs/new-receipt.md", content: "new\n" },
            { type: "append", path: "docs/ARCHITECTURE.md", content: "changed\n" }
          ]
        }
      });
      expect(writeChanges.isError).toBeUndefined();

      const firstReceipt = await client.callTool({
        name: "repo_last_write",
        arguments: { repo_id: "fixture" }
      });
      expect(firstReceipt.structuredContent).toMatchObject({
        found: true,
        receipt: {
          tool: "repo_write_changes",
          touched_paths: ["docs/new-receipt.md", "docs/ARCHITECTURE.md"],
          changed_paths: ["docs/new-receipt.md", "docs/ARCHITECTURE.md"],
          created_paths: ["docs/new-receipt.md"],
          modified_paths: ["docs/ARCHITECTURE.md"],
          counts: { requested: 2, changed: 2, created: 1, unchanged: 0 },
          summary: "Applied 2 changes across 2 files."
        }
      });
      const firstOperationId = (firstReceipt.structuredContent as {
        receipt?: { operation_id?: string };
      }).receipt?.operation_id;

      await client.callTool({
        name: "repo_write_file",
        arguments: {
          repo_id: "fixture",
          path: "docs/dry-run-no-receipt.md",
          content: "dry\n",
          dry_run: true
        }
      });
      await client.callTool({
        name: "repo_write_file",
        arguments: {
          repo_id: "fixture",
          path: "secrets/blocked.md",
          content: "blocked\n"
        }
      });
      await client.callTool({
        name: "repo_write_file",
        arguments: {
          repo_id: "fixture",
          path: "docs/ARCHITECTURE.md",
          content: "# Architecture\nDecision: keep tools read-only.\nConvention: use contracts first.\nchanged\n"
        }
      });

      const finalReceipt = await client.callTool({
        name: "repo_last_write",
        arguments: { repo_id: "fixture" }
      });

      expect((finalReceipt.structuredContent as {
        receipt?: { operation_id?: string };
      }).receipt?.operation_id).toBe(firstOperationId);
    } finally {
      await close();
    }
  });

  test("repo_write_handoff returns success envelope from HandoffService", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const result = await client.callTool({
        name: "repo_write_handoff",
        arguments: {
          repo_id: "fixture",
          title: "MCP Handoff",
          current_state: "Tool wiring is under test.",
          why: "The next ChatGPT session needs local resume context.",
          next_steps: [{ title: "Continue Slice v2.2" }],
          dry_run: true
        }
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        ok: true,
        dry_run: true,
        handoff_path: expect.stringMatching(/^\.chatgpt\/handoffs\/\d{4}-\d{2}-\d{2}-\d{4}-mcp-handoff\.local\.md$/),
        current_path: ".chatgpt/handoffs/current.local.md",
        updated_current: true,
        branch: expect.any(String),
        head_sha: expect.any(String),
        clean: false,
        startup_prompt: expect.stringContaining("repo_id `fixture`"),
        current_next_step: "Continue Slice v2.2",
        warnings: []
      });
      expect(result.content).toEqual([
        { type: "text", text: expect.stringContaining("Dry run checked handoff") }
      ]);
    } finally {
      await close();
    }
  });

  test("representative calls for every tool match their output schema", async () => {
    const { client, close, head } = await connectFixtureServer();
    try {
      for (const [name, args] of Object.entries(representativeCalls(head))) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, name).toBeUndefined();
        expect(result.structuredContent, name).toBeDefined();

        const definition = toolCatalog.find((tool) => tool.name === name);
        expect(definition, name).toBeDefined();
        const parsed = definition!.outputSchema.safeParse(result.structuredContent);
        expect(parsed.error?.issues, name).toBeUndefined();
        expect(result.content, name).toEqual([
          expect.objectContaining({ type: "text", text: expect.any(String) })
        ]);
      }
    } finally {
      await close();
    }
  });
});

function representativeCalls(head: string): Record<string, Record<string, unknown>> {
  return {
  repo_list_roots: {},
  repo_last_write: { repo_id: "fixture" },
  repo_tree: { repo_id: "fixture", path: ".", max_depth: 2, page_size: 10 },
  repo_search: { repo_id: "fixture", query: "Fixture", max_results: 5 },
  repo_fetch_file: { repo_id: "fixture", path: "README.md", start_line: 1, end_line: 5 },
  repo_read_many: { repo_id: "fixture", paths: ["README.md", "src/app.ts"], max_files: 2 },
  repo_git_status: { repo_id: "fixture" },
  repo_git_diff: { repo_id: "fixture" },
  repo_git_review: { repo_id: "fixture" },
  repo_git_stage: { repo_id: "fixture", paths: ["docs/write-dry-run.md"], expected_head_sha: head, dry_run: true },
  repo_git_unstage: { repo_id: "fixture", paths: ["docs/staged.md"], expected_head_sha: head, dry_run: true },
  repo_git_restore_paths: { repo_id: "fixture", paths: ["docs/write-dry-run.md"], expected_head_sha: head, dry_run: true },
  repo_git_commit: { repo_id: "fixture", message: "Update staged docs", expected_head_sha: head, expected_staged_paths: ["docs/staged.md"], dry_run: true },
  repo_write_stage: { repo_id: "fixture", paths: ["docs/write-dry-run.md"], expected_head_sha: head, dry_run: true },
  repo_write_unstage: { repo_id: "fixture", paths: ["docs/staged.md"], expected_head_sha: head, dry_run: true },
  repo_write_commit: { repo_id: "fixture", message: "Update staged docs", expected_head_sha: head, expected_staged_paths: ["docs/staged.md"], dry_run: true },
  repo_write_stage_commit: { repo_id: "fixture", paths: ["docs/staged.md"], message: "Update staged docs", expected_head_sha: head, dry_run: true },
  repo_write_recover: { repo_id: "fixture", restore_paths: ["docs/write-dry-run.md"], cleanup_paths: [".chatgpt/tool-tests/cleanup.txt"], expected_head_sha: head, dry_run: true },
  repo_cleanup_paths: { repo_id: "fixture", paths: [".chatgpt/tool-tests/cleanup.txt"], dry_run: true },
  repo_project_brief: { repo_id: "fixture" },
  repo_project_memory: { repo_id: "fixture" },
  repo_task_inventory: { repo_id: "fixture", max_results: 5 },
  repo_decision_memory: { repo_id: "fixture" },
  repo_change_plan: { repo_id: "fixture", goal: "Add fixture validation", planning_depth: "quick" },
  repo_next_action: { repo_id: "fixture", mode: "plan", horizon: "today" },
  repo_prepare_codex_task: {
    repo_id: "fixture",
    title: "Fix fixture docs",
    objective: "Read docs/ARCHITECTURE.md and propose a focused Codex implementation.",
    inspect_first: ["docs/ARCHITECTURE.md"],
    allowed_paths: ["docs/ARCHITECTURE.md"],
    verification_commands: ["npm test -- tests/mcp-contract.test.ts"]
  },
  repo_write_codex_task: {
    repo_id: "fixture",
    title: "Fix fixture docs",
    objective: "Read docs/ARCHITECTURE.md and propose a focused Codex implementation.",
    inspect_first: ["docs/ARCHITECTURE.md"],
    allowed_paths: ["docs/ARCHITECTURE.md"],
    dry_run: true
  },
  repo_write_codex_tasks_batch: {
    repo_id: "fixture",
    seeds: [
      {
        title: "Survey fixture docs",
        objective: "Read docs/ARCHITECTURE.md and summarize one focused follow-up.",
        inspect_first: ["docs/ARCHITECTURE.md"],
        allowed_paths: ["docs/ARCHITECTURE.md"]
      },
      {
        title: "Brief fixture tests",
        objective: "Read tests/mcp-contract.test.ts and summarize expected contract coverage.",
        inspect_first: ["tests/mcp-contract.test.ts"],
        allowed_paths: ["tests/mcp-contract.test.ts"]
      }
    ],
    dry_run: true
  },
  repo_codex_review: {
    repo_id: "fixture",
    run_id: "2026-06-04T081500Z-fix-fixture-docs"
  },
  codex_run_and_wait: {
    repo_id: "fixture",
    run_id: "2026-06-04T081500Z-fix-fixture-docs",
    dry_run: true
  },
  repo_lab_exec: {
    repo_id: "fixture",
    command: "node shared/experiments/town-lab-2026-06-13/portal-validator-lab.mjs",
    timeout_seconds: 5
  },
  repo_write_file: { repo_id: "fixture", path: "docs/write-file-dry-run.md", content: "planned\n", dry_run: true },
  repo_write_changes: {
    repo_id: "fixture",
    changes: [
      { type: "write", path: "docs/write-changes-dry-run.md", content: "planned\n" },
      {
        type: "edit",
        path: "docs/ARCHITECTURE.md",
        edits: [
          { type: "replace", find: "Decision: keep tools read-only.", replace: "Decision: keep tools safe by default." },
          { type: "insert_after", find: "Convention: use contracts first.", content: "\nConvention: review grouped edits through git." }
        ]
      }
    ],
    dry_run: true
  },
  repo_write_handoff: {
    repo_id: "fixture",
    title: "Representative Handoff",
    current_state: "Representative MCP contract call is running.",
    why: "Output schema should validate for the handoff tool.",
    next_steps: [{ title: "Review handoff output" }],
    dry_run: true
  }
  };
}

async function connectFixtureServer() {
  const root = await createRepoRoot();
  const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, env: { PATH: process.env.PATH ?? "" } })).stdout.trim();
  const registry = await RootRegistry.fromConfig({
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
  const server = createMcpServer({ registry });
  const client = new Client({ name: "contract-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);

  return {
    client,
    root,
    head,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

async function createRepoRoot() {
  const root = await mkdtemp(join(tmpdir(), "gpt-repo-mcp-contract-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, ".chatgpt", "tool-tests"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await writeFile(join(root, "docs", "ARCHITECTURE.md"), "# Architecture\nDecision: keep tools read-only.\nConvention: use contracts first.\n");
  await writeFile(join(root, "TODO.md"), "- [ ] Wire repo_task_inventory\n");
  await writeFile(join(root, "package.json"), JSON.stringify({
    type: "module",
    scripts: {
      build: "tsc",
      test: "vitest"
    },
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.0.0"
    }
  }, null, 2));
  await writeFile(join(root, "src", "app.ts"), "export const fixture = true;\n");
  await execFileAsync("git", ["init"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["add", "--", "README.md", "docs/ARCHITECTURE.md", "TODO.md", "package.json", "src/app.ts"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await writeFile(join(root, "src-placeholder.txt"), "changed\n");
  await writeFile(join(root, "docs", "staged.md"), "staged\n");
  await writeFile(join(root, "docs", "write-dry-run.md"), "planned\n");
  await writeFile(join(root, ".chatgpt", "tool-tests", "cleanup.txt"), "temporary\n");
  await execFileAsync("git", ["add", "--", "docs/staged.md"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  return root;
}

async function writeCapabilityToc(root: string): Promise<void> {
  await mkdir(join(root, "shared", "capabilities"), { recursive: true });
  await writeFile(join(root, "shared", "capabilities", "BRIDGE_CAPABILITY_TOC_V0.json"), JSON.stringify({
    generated_at: "2026-06-12T08:46:28Z",
    capabilities: [{
      capability_id: "town_portal",
      status: "documented_experimental",
      summary: "Single-use continuation handle.",
      existing_tool_or_hub_route: "repo_runner_status.capability_summary.capability_toc",
      docs_protocol_refs: ["shared/protocols/TOWN_PORTAL_PRIMITIVE_V0.md"],
      safe_operations: ["display_only_knowledge_record"],
      blocked_operations: ["queue_codex_runs"],
      suggested_next_action: "Implement read-only hub summary first."
    }]
  }));
  await writeFile(join(root, "shared", "capabilities", "BRIDGE_MODULE_REGISTRY_V0.json"), JSON.stringify({
    generated_at: "2026-06-13T00:48:49Z",
    modules: [
      {
        module_id: "save_crystal",
        status: "documented_draft",
        class: "protocol_backed",
        summary: "Checkpoint detection and helper packaging.",
        source_refs: ["shared/protocols/AUTONOMOUS_SAVE_CRYSTAL_LANE_V0.md"],
        groups_capabilities: ["fresh_state_preflight"],
        public_surface: "existing hub/status/repo review routes only; no new tool name",
        safe_actions: ["inspect_status"],
        blocked_actions: ["push"]
      },
      {
        module_id: "town_portal",
        status: "documented_experimental",
        class: "validator_needed",
        summary: "Single-use continuation handle.",
        source_refs: ["shared/protocols/TOWN_PORTAL_PRIMITIVE_V0.md"],
        groups_capabilities: ["town_portal"],
        public_surface: "capability hub summary",
        safe_actions: ["display_only_knowledge_record"],
        blocked_actions: ["queue_codex_runs"]
      }
    ]
  }));
}

async function writePortalFixtures(root: string): Promise<void> {
  await mkdir(join(root, "shared", "portals", "objects"), { recursive: true });
  await mkdir(join(root, "shared", "portals", "receipts", "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d"), { recursive: true });
  await mkdir(join(root, "shared", "portals", "receipts", "portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee"), { recursive: true });
  await mkdir(join(root, "shared", "portals", "receipts", "portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e"), { recursive: true });

  await writeFile(join(root, "shared", "portals", "inbox.md"), `# Portal Inbox

| Portal ID | Status | Archetype | Lane | Opened At | Expires At | Summary | Object | Latest Receipt | Next Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| \`portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee\` | \`active\` | \`verifier\` | \`knowledge\` | \`2026-06-13T16:45:00.000Z\` | \`2026-06-13T17:15:00.000Z\` | Active portal still allows one bounded verification return. | \`shared/portals/objects/portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee.json\` | \`shared/portals/receipts/portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee/2026-06-13T16-45-00.000Z-opened.json\` | \`continue_or_refresh\` |
| \`portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d\` | \`returned\` | \`scout\` | \`knowledge\` | \`2026-06-13T16:35:21.582Z\` | \`2026-06-13T17:05:21.582Z\` | Fresh chat recovered the portal and proposed a bounded status note. | \`shared/portals/objects/portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d.json\` | \`shared/portals/receipts/portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d/2026-06-13T16-42-00.000Z-returned.json\` | \`accept_or_park\` |
| \`portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e\` | \`consumed\` | \`builder\` | \`knowledge\` | \`2026-06-13T15:05:00.000Z\` | \`2026-06-13T15:35:00.000Z\` | Accepted once and compacted into durable consumed history. | \`shared/portals/objects/portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e.json\` | \`shared/portals/receipts/portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e/2026-06-13T15-14-00.000Z-consumed.json\` | \`history_only\` |
`, "utf8");

  await writeFile(join(root, "shared", "portals", "objects", "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d.json"), `${JSON.stringify({
    schema_version: 1,
    id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
    type: "town_portal",
    archetype: "scout",
    lane: "knowledge",
    opened_at: "2026-06-13T16:35:21.582Z",
    expires_at: "2026-06-13T17:05:21.582Z",
    allowed_paths: ["shared/status/**", "shared/portals/**"],
    allowed_operation: "write_observation",
    observed_state_hash: "sha256:sample-scout-status-lab-semantic-hash",
    target_return_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md",
    status: "returned",
    return_card: {
      kind: "portal_return_card_scout_v0",
      summary: "Fresh chat recovered the portal and proposed a bounded status note.",
      artifact_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md",
      evidence_links: ["shared/protocols/TOWN_PORTAL_PRODUCTION_CONTRACT_V0.md"],
      next_requested_decision: "accept_or_park",
      observed_state_hash: "sha256:sample-scout-status-lab-semantic-hash",
      target_return_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md"
    },
    evidence_links: ["shared/protocols/TOWN_PORTAL_PRIMITIVE_V0.md"],
    consumed_at: null,
    consumed_by: null,
    session_metadata: {
      opened_by_chat: "sample-chat-a",
      opened_by_tool: "repo_bridge_concierge",
      returned_by_chat: "sample-chat-b"
    },
    next_requested_decision: "accept_or_park",
    revision: 3,
    latest_receipt_path: "shared/portals/receipts/portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d/2026-06-13T16-42-00.000Z-returned.json"
  }, null, 2)}\n`, "utf8");

  await writeFile(join(root, "shared", "portals", "objects", "portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee.json"), `${JSON.stringify({
    schema_version: 1,
    id: "portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee",
    type: "town_portal",
    archetype: "verifier",
    lane: "knowledge",
    opened_at: "2026-06-13T16:45:00.000Z",
    expires_at: "2026-06-13T17:15:00.000Z",
    allowed_paths: ["shared/status/**", "shared/portals/**"],
    allowed_operation: "write_observation",
    observed_state_hash: "sha256:sample-verifier-queue-check-semantic-hash",
    target_return_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md",
    status: "active",
    return_card: {
      kind: "portal_return_card_verifier_v0",
      summary: "Active portal still allows one bounded verification return.",
      artifact_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md",
      evidence_links: ["shared/status/2026-06-13-lab-exec-live-check.md"],
      next_requested_decision: "continue_or_refresh",
      observed_state_hash: "sha256:sample-verifier-queue-check-semantic-hash",
      target_return_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md"
    },
    evidence_links: ["shared/status/2026-06-13-lab-exec-live-check.md"],
    consumed_at: null,
    consumed_by: null,
    session_metadata: {
      opened_by_chat: "sample-chat-d",
      opened_by_tool: "repo_runner_status"
    },
    next_requested_decision: "continue_or_refresh",
    revision: 1,
    latest_receipt_path: "shared/portals/receipts/portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee/2026-06-13T16-45-00.000Z-opened.json"
  }, null, 2)}\n`, "utf8");

  await writeFile(join(root, "shared", "portals", "objects", "portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e.json"), `${JSON.stringify({
    schema_version: 1,
    id: "portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e",
    type: "town_portal",
    archetype: "builder",
    lane: "knowledge",
    opened_at: "2026-06-13T15:05:00.000Z",
    expires_at: "2026-06-13T15:35:00.000Z",
    allowed_paths: ["shared/status/**"],
    allowed_operation: "write_observation",
    observed_state_hash: "sha256:sample-builder-proof-semantic-hash",
    target_return_path: "shared/status/2026-06-13-lab-portal-return-route.md",
    status: "consumed",
    return_card: {
      kind: "portal_return_card_builder_v0",
      summary: "Accepted once and compacted into durable consumed history.",
      artifact_path: "shared/status/2026-06-13-lab-portal-return-route.md",
      evidence_links: ["shared/experiments/town-lab-2026-06-13/portal-return-lab-route-run.md"],
      next_requested_decision: "history_only",
      observed_state_hash: "sha256:sample-builder-proof-semantic-hash",
      target_return_path: "shared/status/2026-06-13-lab-portal-return-route.md"
    },
    evidence_links: ["shared/status/2026-06-13-lab-portal-return-route.md"],
    consumed_at: "2026-06-13T15:14:00.000Z",
    consumed_by: {
      chat_id: "sample-chat-c",
      tool: "portal_inbox_reader_v0"
    },
    session_metadata: {
      opened_by_chat: "sample-chat-c",
      returned_by_chat: "sample-chat-c"
    },
    next_requested_decision: "history_only",
    revision: 4,
    latest_receipt_path: "shared/portals/receipts/portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e/2026-06-13T15-14-00.000Z-consumed.json"
  }, null, 2)}\n`, "utf8");

  await writeFile(join(root, "shared", "portals", "receipts", "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d", "2026-06-13T16-42-00.000Z-returned.json"), `${JSON.stringify({
    receipt_type: "portal_transition",
    portal_id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
    from_status: "active",
    to_status: "returned",
    recorded_at: "2026-06-13T16:42:00.000Z",
    recorded_by: {
      chat_id: "sample-chat-b",
      tool: "repo_bridge_concierge"
    },
    expected_revision: 2,
    new_revision: 3,
    observed_state_hash: "sha256:sample-scout-status-lab-semantic-hash",
    target_return_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md",
    next_requested_decision: "accept_or_park",
    summary: "Fresh chat returned a bounded recovery card and is waiting for accept or park."
  }, null, 2)}\n`, "utf8");

  await writeFile(join(root, "shared", "portals", "receipts", "portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee", "2026-06-13T16-45-00.000Z-opened.json"), `${JSON.stringify({
    receipt_type: "portal_transition",
    portal_id: "portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee",
    from_status: "open",
    to_status: "active",
    recorded_at: "2026-06-13T16:45:00.000Z",
    summary: "Portal opened for one bounded verification lane."
  }, null, 2)}\n`, "utf8");

  await writeFile(join(root, "shared", "portals", "receipts", "portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e", "2026-06-13T15-14-00.000Z-consumed.json"), `${JSON.stringify({
    receipt_type: "portal_transition",
    portal_id: "portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e",
    from_status: "accepted",
    to_status: "consumed",
    recorded_at: "2026-06-13T15:14:00.000Z",
    summary: "Portal consumed after accepted build proof."
  }, null, 2)}\n`, "utf8");
}
