import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_INSTRUCTIONS, getServerInstructions } from "./instructions.js";
import { getToolCatalogForProfile, type ToolDefinition } from "./tools/catalog.js";
import { toolCatalogProfileFromEnv, type ToolCatalogProfile } from "./tools/catalog-profile.js";
import { registerCatalogTool } from "./tools/define-tool.js";
import type { RuntimeContext } from "./runtime/context.js";

export { SERVER_INSTRUCTIONS };

export function createMcpServer(
  context: RuntimeContext,
  options: {
    toolProfile?: ToolCatalogProfile;
    toolCatalog?: ToolDefinition[];
    instructions?: string;
  } = {}
): McpServer {
  const toolProfile = options.toolProfile ?? toolCatalogProfileFromEnv();
  const activeToolCatalog = options.toolCatalog ?? getToolCatalogForProfile(toolProfile);
  const instructions = options.instructions ?? getServerInstructions(toolProfile);
  const server = new McpServer(
    {
      name: "gpt-repo-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      },
      instructions
    }
  );

  for (const tool of activeToolCatalog) {
    registerCatalogTool(server, context, tool);
  }

  return server;
}
