import { execFile } from "node:child_process";

export type VisionRouteName = "gemini_api" | "vertex_gemini" | "ollama_local";
export type MissingVisionCapability =
  | "MISSING_IMAGE_INPUT_ASSET"
  | "MISSING_GEMINI_API_KEY"
  | "MISSING_VERTEX_AUTH"
  | "MISSING_LOCAL_GEMMA_VISION_MODEL"
  | "NO_CONFIGURED_VISION_ROUTE";

export type VisionRoute = {
  route: VisionRouteName;
  available: boolean;
  auth?: "api_key" | "adc" | "service_account" | "none";
  model?: string;
  supports_image_input?: boolean;
  evidence: string[];
};

export type VisionRouteResult = {
  ok: true;
  has_configured_vision_route: boolean;
  available_routes: VisionRoute[];
  missing_capabilities: MissingVisionCapability[];
  warnings: string[];
};

export type VisionAnalysisFallback = {
  tool: "repo_write_codex_task";
  route_status: "ready" | "blocked";
  input_assets_required: true;
  result_visibility: "repo_list_roots.ready_results";
  preferred_route?: {
    route: VisionRouteName;
    model?: string;
    evidence: string[];
  };
  payload_notes: string[];
  completed_result_template: string;
  blocked_result_template: string;
};

export type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type VisionRouteServiceOptions = {
  env?: Record<string, string | undefined>;
  commandRunner?: (command: string, args: string[]) => Promise<CommandResult>;
};

const VISION_MODEL_PATTERNS = [
  /\bllava\b/i,
  /\bmoondream\b/i,
  /\bminicpm-v\b/i,
  /\bpaligemma\b/i,
  /\bgemma.*vision\b/i,
  /\bgemma.*vl\b/i
];

const GEMMA_MODEL_PATTERN = /\bgemma/i;

export class VisionRouteService {
  private readonly env: Record<string, string | undefined>;
  private readonly commandRunner: (command: string, args: string[]) => Promise<CommandResult>;

  constructor(options: VisionRouteServiceOptions = {}) {
    this.env = options.env ?? process.env;
    this.commandRunner = options.commandRunner ?? runCommand;
  }

  async detect(): Promise<VisionRouteResult> {
    const routes: VisionRoute[] = [];
    const missing = new Set<MissingVisionCapability>();
    const warnings: string[] = [];

    if (this.env.GEMINI_API_KEY || this.env.GOOGLE_API_KEY) {
      routes.push({
        route: "gemini_api",
        available: true,
        auth: "api_key",
        supports_image_input: true,
        evidence: [this.env.GEMINI_API_KEY ? "GEMINI_API_KEY_PRESENT" : "GOOGLE_API_KEY_PRESENT"]
      });
    } else {
      missing.add("MISSING_GEMINI_API_KEY");
    }

    if (this.env.GOOGLE_APPLICATION_CREDENTIALS) {
      routes.push({
        route: "vertex_gemini",
        available: true,
        auth: "service_account",
        supports_image_input: true,
        evidence: ["GOOGLE_APPLICATION_CREDENTIALS_PRESENT"]
      });
    } else {
      missing.add("MISSING_VERTEX_AUTH");
    }

    const ollama = await this.commandRunner("ollama", ["list"]).catch((error: unknown) => {
      warnings.push(error instanceof Error ? error.message : "ollama list failed");
      return { ok: false, stdout: "", stderr: "" };
    });
    const ollamaModels = parseOllamaModels(ollama.stdout);
    const shownVisionModel = await this.firstOllamaShowVisionModel(ollamaModels);
    const visionModel = shownVisionModel ?? ollamaModels.find((model) => VISION_MODEL_PATTERNS.some((pattern) => pattern.test(model)));
    if (visionModel) {
      routes.push({
        route: "ollama_local",
        available: true,
        auth: "none",
        model: visionModel,
        supports_image_input: true,
        evidence: [shownVisionModel ? "OLLAMA_SHOW_CAPABILITIES_VISION" : "OLLAMA_MODEL_NAME_ADVERTISES_IMAGE_INPUT"]
      });
    } else {
      const gemmaModel = ollamaModels.find((model) => GEMMA_MODEL_PATTERN.test(model));
      if (gemmaModel) {
        routes.push({
          route: "ollama_local",
          available: true,
          auth: "none",
          model: gemmaModel,
          supports_image_input: false,
          evidence: ["OLLAMA_GEMMA_TEXT_MODEL_PRESENT"]
        });
      }
      missing.add("MISSING_LOCAL_GEMMA_VISION_MODEL");
    }

    const hasConfiguredVisionRoute = routes.some((route) => route.available && route.supports_image_input === true);
    if (!hasConfiguredVisionRoute) {
      missing.add("NO_CONFIGURED_VISION_ROUTE");
    }

    return {
      ok: true,
      has_configured_vision_route: hasConfiguredVisionRoute,
      available_routes: routes,
      missing_capabilities: [...missing],
      warnings
    };
  }

  private async firstOllamaShowVisionModel(models: string[]): Promise<string | undefined> {
    for (const model of models.slice(0, 20)) {
      const shown = await this.commandRunner("ollama", ["show", model]).catch(() => ({ ok: false, stdout: "", stderr: "" }));
      if (shown.ok && /\bCapabilities\b[\s\S]*\bvision\b/i.test(shown.stdout)) {
        return model;
      }
    }
    return undefined;
  }
}

export function buildVisionAnalysisFallback(result: VisionRouteResult): VisionAnalysisFallback {
  const preferredRoute = result.available_routes.find((route) => route.available && route.supports_image_input === true);
  const missing = result.missing_capabilities.length > 0
    ? result.missing_capabilities.join(", ")
    : "NO_CONFIGURED_VISION_ROUTE";
  return {
    tool: "repo_write_codex_task",
    route_status: preferredRoute ? "ready" : "blocked",
    input_assets_required: true,
    result_visibility: "repo_list_roots.ready_results",
    ...(preferredRoute ? {
      preferred_route: {
        route: preferredRoute.route,
        ...(preferredRoute.model ? { model: preferredRoute.model } : {}),
        evidence: preferredRoute.evidence
      }
    } : {}),
    payload_notes: [
      "Attach the image through repo_write_codex_task.input_assets; the bridge stores it under .chatgpt/codex-runs/<run_id>/inputs/.",
      "Use repo-local input asset paths from PROMPT.md; do not rely on chat-only attachments or /mnt/data.",
      "Prefer a validated local Ollama/Gemma vision route when available.",
      "After Codex writes RESULT.md, read repo_list_roots.ready_results for completed or blocked output."
    ],
    completed_result_template: [
      "# CODEX_RESULT",
      "status: completed",
      "summary: <visual analysis summary>",
      "changed_files:",
      "- none",
      "commands_run:",
      "- <local Ollama/Gemma vision command or test command>",
      "tests:",
      "- completed local image analysis using repo-local input asset",
      "acceptance_criteria:",
      "- image analysis result is readable through repo_list_roots.ready_results",
      "blockers:",
      "- none",
      "followups:",
      "- none"
    ].join("\n"),
    blocked_result_template: [
      "# CODEX_RESULT",
      "status: blocked",
      `summary: No validated local image-analysis route is available. Missing: ${missing}.`,
      "changed_files:",
      "- none",
      "commands_run:",
      "- repo_vision_routes or repo_list_roots vision capability fallback",
      "tests:",
      "- blocked before image analysis because required route capability is missing",
      "acceptance_criteria:",
      "- exact missing capability is reported",
      "blockers:",
      `- ${missing}`,
      "followups:",
      "- configure a local Ollama/Gemma model that advertises vision"
    ].join("\n")
  };
}

function parseOllamaModels(output: string): string[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => Boolean(name));
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 5000 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? "")
      });
    });
  });
}
