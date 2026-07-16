import { createServer } from "node:http";
import { portfolioConsoleWidgetHtml } from "../src/apps/portfolio-console-widget.js";

const report = {
  report_id: "browser-proof-portfolio",
  repo_id: "shared-agent-bridge",
  source_generated_at: "2026-07-15T18:00:00.000Z",
  summary: "Three evidence-derived actions across two active projects.",
  freshness: "fresh",
  source_age_days: 0,
  console_state: { version: 1, updated_at: "", project_seen: [], playbooks: [], artifacts: [] },
  sections: [
    {
      topic: "Active work",
      headline: "Widget interaction proof",
      items: ["Select individual actions.", "Preserve state across collapsed groups.", "Route one guarded bundle."],
    },
  ],
  project_workspaces: [
    {
      id: "shared-agent-bridge", name: "Shared Agent Bridge", status: "active", phase: "operations console v2",
      product_track: "phone-first visual control plane", confidence: "high",
      summary: "Coordinates ChatGPT, Codex, and Hermes through verified tools and durable receipts.",
      latest_evidence_at: "2026-07-15T19:00:00.000Z", active_action_count: 0, handled_action_count: 0,
      milestones: ["Phone operations console [active] — verify mobile interaction"],
      recent_results: ["2026-07-15: Durable action ledger verified."],
      next_moves: ["Exercise the project re-entry packet in a fresh thread."],
      watch_topics: ["Connector cache behavior [watching]"],
      artifacts: [{ artifact_id: "widget-proof", project_id: "shared-agent-bridge", title: "Widget proof image", kind: "image", source: "shared/status/widget-proof.png", observed_at: "2026-07-15T19:00:00.000Z", mime_type: "image/png", preview_url: "", open_url: "", previewable: false }],
      reentry_prompt: "Resume Shared Agent Bridge from REENTRY_PACKET_V1. Resolve the live repo and verify current evidence before acting."
    },
    {
      id: "hermes", name: "Hermes", status: "active", phase: "resident supervision",
      product_track: "durable off-thread work", confidence: "high",
      summary: "Runs durable work with Kanban and acceptance receipts.",
      latest_evidence_at: "2026-07-15T18:30:00.000Z", active_action_count: 0, handled_action_count: 0,
      milestones: ["Resident watch [active] — keep evidence visible"], recent_results: [],
      next_moves: ["Inspect current blockers."], watch_topics: [],
      artifacts: [],
      reentry_prompt: "Resume Hermes from REENTRY_PACKET_V1. Verify current Kanban and transaction receipts before acting."
    }
  ],
  actions: [
    {
      action_id: "verify-mount",
      project_id: "shared-agent-bridge",
      project_name: "Shared Agent Bridge",
      title: "Verify widget mounting",
      route: "bridge.widget.verify",
      risk: "read_only",
      rationale: "Confirm the app remains interactive in its host frame.",
      prompt: "Verify the current widget mount and report evidence.",
    },
    {
      action_id: "review-routing",
      project_id: "shared-agent-bridge",
      project_name: "Shared Agent Bridge",
      title: "Review decision routing",
      route: "bridge.bundle.review",
      risk: "read_only",
      rationale: "Confirm selected actions become one ChatGPT decision bundle.",
      prompt: "Review the decision bundle routing and report evidence.",
    },
    {
      action_id: "inspect-hermes",
      project_id: "hermes",
      project_name: "Hermes",
      title: "Inspect current Hermes blockers",
      route: "hermes.task.review",
      risk: "read_only",
      rationale: "Show that unrelated projects can be selected together.",
      prompt: "Inspect current Hermes blockers without mutating the board.",
    },
  ],
  active_actions: [],
  history_actions: [],
  recent_activity: [],
  hidden_action_count: 0,
  warnings: [],
};

const openAiShim = `<script>
window.__routedBundle = null;
window.__ledger = [];
window.__consoleState = ${JSON.stringify({ version: 1, updated_at: "", project_seen: [], playbooks: [], artifacts: [] })};
window.openai = {
  toolOutput: ${JSON.stringify(report)},
  callTool: async (name, args) => {
    if (name === "repo_portfolio_action_command") {
      const now = new Date().toISOString();
      if (args.operation === "sync_console") {
        const patch = args.console_patch || {};
        if (patch.project_seen) {
          const seen = new Map(window.__consoleState.project_seen.map(item=>[item.project_id,item.seen_at]));
          for (const item of patch.project_seen) seen.set(item.project_id,item.seen_at);
          window.__consoleState.project_seen = [...seen].map(([project_id,seen_at])=>({project_id,seen_at}));
        }
        if (patch.upsert_playbook) {
          window.__consoleState.playbooks = window.__consoleState.playbooks.filter(item=>item.name!==patch.upsert_playbook.name);
          window.__consoleState.playbooks.push({...patch.upsert_playbook,updated_at:now});
        }
        if (patch.delete_playbook) window.__consoleState.playbooks = window.__consoleState.playbooks.filter(item=>item.name!==patch.delete_playbook);
        if (patch.upsert_artifact) {
          window.__consoleState.artifacts = window.__consoleState.artifacts.filter(item=>item.artifact_id!==patch.upsert_artifact.artifact_id);
          window.__consoleState.artifacts.push(patch.upsert_artifact);
        }
        if (patch.delete_artifact) window.__consoleState.artifacts = window.__consoleState.artifacts.filter(item=>item.artifact_id!==patch.delete_artifact);
        window.__consoleState.updated_at = now;
        window.openai.toolOutput.console_state = window.__consoleState;
        return {structuredContent:{ok:true,changed_count:1,unchanged_count:0,entries:[],recent_activity:[],console_state:window.__consoleState}};
      }
      for (const action of args.actions) {
        window.__ledger = window.__ledger.filter(item => item.action_id !== action.action_id);
        const states = {route:"routed",working:"working",complete:"completed",stop:"stopped",snooze:"snoozed",archive:"archived",restore:"available"};
        window.__ledger.push({...action, state: states[args.operation], report_id: args.report_id || "", attempt_count: 1, updated_at: now, reason: args.reason || "", receipt_summary: args.receipt_summary || "",snooze_until:args.snooze_until||""});
      }
      return {structuredContent:{ok:true,changed_count:args.actions.length,unchanged_count:0,entries:window.__ledger,recent_activity:[]}};
    }
    if (name === "repo_portfolio_report") {
      const handled = new Set(window.__ledger.map(item => item.action_id));
      return {structuredContent:{...window.openai.toolOutput,console_state:window.__consoleState,actions:window.openai.toolOutput.actions.filter(item=>!handled.has(item.action_id)),active_actions:window.__ledger.filter(item=>item.state==="routed"||item.state==="working"),history_actions:window.__ledger.filter(item=>!["routed","working","available"].includes(item.state)),recent_activity:window.__ledger.map(item=>({event_id:item.action_id,action_id:item.action_id,project_id:item.project_id,title:item.title,operation:item.state,from_state:"unseen",to_state:item.state,observed_at:item.updated_at,reason:item.reason,receipt_summary:item.receipt_summary}))}};
    }
    throw new Error("Unsupported harness tool: "+name);
  },
  sendFollowUpMessage: async (message) => {
    window.__routedBundle = message;
    document.documentElement.dataset.routed = "true";
    document.documentElement.dataset.routedPrompt = message.prompt;
  }
};
</script>`;

const html = portfolioConsoleWidgetHtml().replace('<script type="module">', `${openAiShim}<script type="module">`);
const port = Number(process.env.PORT ?? 8791);
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(html);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Portfolio widget harness: http://127.0.0.1:${port}\n`);
});
