import { createHash } from "node:crypto";
import { fullToolCatalog, type ToolDefinition } from "../tools/catalog.js";
import type { ToolCatalogProfile } from "../tools/catalog-profile.js";

export const REQUIRED_CHATGPT_TOOLS = [
  "repo_list_roots",
  "repo_bridge_concierge",
  "repo_hermes_intake",
  "repo_hermes_intervene",
  "repo_read",
  "repo_project_context",
  "repo_write_codex_task",
  "repo_codex_review",
  "repo_git_status",
  "repo_git_review",
  "repo_runner_status",
  "repo_write_changes",
  "repo_write_recover",
  "repo_write_stage_commit"
] as const;

export type ToolCatalogDiagnostic = {
  ok: boolean;
  name: "gpt-repo-mcp";
  started_at: string;
  build_timestamp: string;
  tool_profile: ToolCatalogProfile;
  tool_count: number;
  full_tool_count: number;
  tool_catalog_hash: string;
  tools: Array<{
    name: string;
    enabled: boolean;
    read_only: boolean;
  }>;
  required_tools: Array<{
    name: string;
    exposed: boolean;
    enabled: boolean;
  }>;
};

export function buildToolCatalogDiagnostic(input: {
  startedAt: string;
  buildTimestamp: string;
  toolCatalog: ToolDefinition[];
  toolProfile?: ToolCatalogProfile;
}): ToolCatalogDiagnostic {
  const toolNames = input.toolCatalog.map((tool) => tool.name).sort();
  const toolNameSet = new Set<string>(toolNames);
  const catalogFingerprint = input.toolCatalog
    .map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: tool.annotations,
      inputSchema: schemaFingerprint(tool.inputSchema),
      outputSchema: schemaFingerprint(tool.outputSchema)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    ok: true,
    name: "gpt-repo-mcp",
    started_at: input.startedAt,
    build_timestamp: input.buildTimestamp,
    tool_profile: input.toolProfile ?? "compact",
    tool_count: toolNames.length,
    full_tool_count: fullToolCatalog.length,
    tool_catalog_hash: createHash("sha256").update(JSON.stringify(catalogFingerprint)).digest("hex").slice(0, 16),
    tools: input.toolCatalog
      .map((tool) => ({
        name: tool.name,
        enabled: true,
        read_only: tool.annotations.readOnlyHint === true
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    required_tools: REQUIRED_CHATGPT_TOOLS.map((name) => ({
      name,
      exposed: toolNameSet.has(name),
      enabled: toolNameSet.has(name)
    }))
  };
}

function schemaFingerprint(schema: unknown): unknown {
  if (schema && typeof schema === "object" && "toJSONSchema" in schema && typeof schema.toJSONSchema === "function") {
    return schema.toJSONSchema();
  }
  return schema;
}
