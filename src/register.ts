import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { SERVER_INSTRUCTIONS, getServerInstructions } from "./instructions.js";
import { getToolCatalogForProfile, type ToolDefinition } from "./tools/catalog.js";
import { toolCatalogProfileFromEnv, type ToolCatalogProfile } from "./tools/catalog-profile.js";
import { registerCatalogTool } from "./tools/define-tool.js";
import type { RuntimeContext } from "./runtime/context.js";
import { HERMES_WATCH_WIDGET_URI } from "./apps/hermes-watch-widget.js";
import { PORTFOLIO_CONSOLE_WIDGET_URI, portfolioConsoleWidgetHtml } from "./apps/portfolio-console-widget.js";

export { SERVER_INSTRUCTIONS };

const PORTFOLIO_CONSOLE_LEGACY_URIS = ["ui://widget/portfolio-console-v4.html", "ui://widget/portfolio-console-v5.html", "ui://widget/portfolio-console-v6.html", "ui://widget/portfolio-console-v7.html"] as const;
const HERMES_WATCH_LEGACY_URIS = ["ui://widget/hermes-watch-v3.html"] as const;

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

  registerAppResource(
    server,
    "Hermes resident watch",
    HERMES_WATCH_WIDGET_URI,
    {
      title: "Hermes resident watch",
      description: "Visible live Hermes status, heartbeat, task counts, and evidence timeline.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: { prefersBorder: true }, "openai/widgetPrefersBorder": true }
    },
    async () => ({
      contents: [{
        uri: HERMES_WATCH_WIDGET_URI,
        mimeType: RESOURCE_MIME_TYPE,
        // Keep the previous URI as a cache-compatible alias, but serve the
        // syntax-validated lightweight hybrid console.
        text: portfolioConsoleWidgetHtml(),
        _meta: { ui: { prefersBorder: true }, "openai/widgetPrefersBorder": true }
      }]
    })
  );

  for (const legacyUri of HERMES_WATCH_LEGACY_URIS) {
    registerAppResource(
      server,
      "Hermes resident watch (compatibility alias)",
      legacyUri,
      {
        title: "Hermes resident watch",
        description: "Compatibility alias for ChatGPT sessions that cached an earlier Hermes widget URI.",
        mimeType: RESOURCE_MIME_TYPE,
        _meta: { ui: { prefersBorder: true }, "openai/widgetPrefersBorder": true }
      },
      async () => ({
        contents: [{
          uri: legacyUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: portfolioConsoleWidgetHtml(),
          _meta: { ui: { prefersBorder: true }, "openai/widgetPrefersBorder": true }
        }]
      })
    );
  }

  registerAppResource(
    server,
    "Portfolio action console",
    PORTFOLIO_CONSOLE_WIDGET_URI,
    { title: "Portfolio action console", description: "Cross-project reports, selectable recommendations, and one-bundle ChatGPT routing.", mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: true }, "openai/widgetPrefersBorder": true } },
    async () => ({ contents: [{ uri: PORTFOLIO_CONSOLE_WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: portfolioConsoleWidgetHtml(), _meta: { ui: { prefersBorder: true }, "openai/widgetPrefersBorder": true } }] })
  );

  for (const legacyUri of PORTFOLIO_CONSOLE_LEGACY_URIS) {
    registerAppResource(
      server,
      "Portfolio action console (compatibility alias)",
      legacyUri,
      {
        title: "Portfolio action console",
        description: "Compatibility alias for ChatGPT sessions that cached an earlier widget URI.",
        mimeType: RESOURCE_MIME_TYPE,
        _meta: { ui: { prefersBorder: true }, "openai/widgetPrefersBorder": true }
      },
      async () => ({
        contents: [{
          uri: legacyUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: portfolioConsoleWidgetHtml(),
          _meta: { ui: { prefersBorder: true }, "openai/widgetPrefersBorder": true }
        }]
      })
    );
  }

  return server;
}
