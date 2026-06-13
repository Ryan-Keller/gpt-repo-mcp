import { describe, expect, test } from "vitest";
import { z } from "zod";
import { readOnlyAnnotations } from "../src/tools/annotations.js";
import { buildToolCatalogDiagnostic } from "../src/runtime/tool-catalog-diagnostic.js";
import { toolCatalog } from "../src/tools/catalog.js";

describe("tool catalog diagnostic", () => {
  test("includes expected stable bridge tools with enabled status", () => {
    const diagnostic = buildToolCatalogDiagnostic({
      startedAt: "2026-06-07T08:00:00.000Z",
      buildTimestamp: "2026-06-07T08:00:00.000Z",
      toolCatalog
    });

    const names = diagnostic.tools.map((tool) => tool.name);

    expect(diagnostic.tool_count).toBe(toolCatalog.length);
    expect(diagnostic.build_timestamp).toBe("2026-06-07T08:00:00.000Z");
    expect(names).toEqual(expect.arrayContaining([
      "repo_list_roots",
      "repo_write_codex_task",
      "repo_write_codex_tasks_batch",
      "codex_run_and_wait",
      "repo_codex_review",
      "repo_git_status",
      "repo_runner_status"
    ]));
    expect(diagnostic.required_tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "repo_runner_status", exposed: true, enabled: true })
    ]));
  });

  test("catalog hash changes when an exposed tool schema changes", () => {
    const baseTool = {
      name: "repo_git_status" as const,
      title: "Read git status",
      description: "Use this when testing schema-sensitive diagnostics.",
      inputSchema: z.object({ repo_id: z.string() }),
      outputSchema: z.object({ clean: z.boolean() }),
      annotations: readOnlyAnnotations,
      handler: async () => ({ content: [] })
    };

    const first = buildToolCatalogDiagnostic({
      startedAt: "2026-06-07T08:00:00.000Z",
      buildTimestamp: "2026-06-07T08:00:00.000Z",
      toolCatalog: [baseTool]
    });
    const second = buildToolCatalogDiagnostic({
      startedAt: "2026-06-07T08:00:00.000Z",
      buildTimestamp: "2026-06-07T08:00:00.000Z",
      toolCatalog: [{
        ...baseTool,
        outputSchema: z.object({ clean: z.boolean(), runner_status: z.object({ runner: z.string() }) })
      }]
    });

    expect(first.tool_catalog_hash).not.toBe(second.tool_catalog_hash);
  });
});
