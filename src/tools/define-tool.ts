import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeContext } from "../runtime/context.js";
import type { ToolDefinition } from "./catalog.js";

export function registerCatalogTool(server: McpServer, context: RuntimeContext, tool: ToolDefinition): void {
  const config = {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema.shape,
      annotations: tool.annotations
  };
  const handler = async (args: Record<string, unknown>) => tool.handler(args, context);
  server.registerTool(tool.name, config, handler);
}
