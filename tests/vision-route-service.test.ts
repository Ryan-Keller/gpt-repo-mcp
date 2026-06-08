import { describe, expect, test } from "vitest";
import { VisionRouteService, buildVisionAnalysisFallback } from "../src/services/vision-route-service.js";

describe("VisionRouteService", () => {
  test("reports typed missing capabilities without leaking secret env values", async () => {
    const service = new VisionRouteService({
      env: {
        GEMINI_API_KEY: "secret-gemini-key",
        GOOGLE_API_KEY: "secret-google-key"
      },
      commandRunner: async () => ({ ok: false, stdout: "", stderr: "not found" })
    });

    const result = await service.detect();

    expect(result.available_routes).toEqual([
      expect.objectContaining({
        route: "gemini_api",
        available: true,
        auth: "api_key"
      })
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-gemini-key");
    expect(JSON.stringify(result)).not.toContain("secret-google-key");
    expect(result.missing_capabilities).toContain("MISSING_VERTEX_AUTH");
    expect(result.missing_capabilities).toContain("MISSING_LOCAL_GEMMA_VISION_MODEL");
  });

  test("returns NO_CONFIGURED_VISION_ROUTE when no route is observable", async () => {
    const service = new VisionRouteService({
      env: {},
      commandRunner: async () => ({ ok: true, stdout: "NAME ID SIZE MODIFIED\nllama3:latest abc 1 GB today\n", stderr: "" })
    });

    const result = await service.detect();

    expect(result.has_configured_vision_route).toBe(false);
    expect(result.missing_capabilities).toEqual(expect.arrayContaining([
      "MISSING_GEMINI_API_KEY",
      "MISSING_VERTEX_AUTH",
      "MISSING_LOCAL_GEMMA_VISION_MODEL",
      "NO_CONFIGURED_VISION_ROUTE"
    ]));
  });

  test("detects local Gemma family models but does not claim vision unless advertised", async () => {
    const service = new VisionRouteService({
      env: {},
      commandRunner: async () => ({ ok: true, stdout: "NAME ID SIZE MODIFIED\ngemma3:12b abc 8 GB today\n", stderr: "" })
    });

    const result = await service.detect();

    expect(result.available_routes).toEqual([
      expect.objectContaining({
        route: "ollama_local",
        model: "gemma3:12b",
        available: true,
        supports_image_input: false
      })
    ]);
    expect(result.has_configured_vision_route).toBe(false);
    expect(result.missing_capabilities).toContain("MISSING_LOCAL_GEMMA_VISION_MODEL");
  });

  test("detects Gemma vision support from ollama show metadata", async () => {
    const service = new VisionRouteService({
      env: {},
      commandRunner: async (command, args) => {
        if (command === "ollama" && args[0] === "list") {
          return { ok: true, stdout: "NAME ID SIZE MODIFIED\nhf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_M abc 7 GB today\n", stderr: "" };
        }
        if (command === "ollama" && args[0] === "show") {
          return { ok: true, stdout: "Capabilities\n  completion\n  vision\n  audio\n", stderr: "" };
        }
        return { ok: false, stdout: "", stderr: "" };
      }
    });

    const result = await service.detect();

    expect(result.has_configured_vision_route).toBe(true);
    expect(result.available_routes[0]).toMatchObject({
      route: "ollama_local",
      model: "hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_M",
      supports_image_input: true,
      evidence: ["OLLAMA_SHOW_CAPABILITIES_VISION"]
    });
    expect(result.missing_capabilities).not.toContain("NO_CONFIGURED_VISION_ROUTE");
  });

  test("detects advertised local vision models", async () => {
    const service = new VisionRouteService({
      env: {},
      commandRunner: async () => ({ ok: true, stdout: "NAME ID SIZE MODIFIED\nllava:latest abc 4 GB today\n", stderr: "" })
    });

    const result = await service.detect();

    expect(result.has_configured_vision_route).toBe(true);
    expect(result.available_routes[0]).toMatchObject({
      route: "ollama_local",
      model: "llava:latest",
      supports_image_input: true
    });
    expect(result.missing_capabilities).not.toContain("NO_CONFIGURED_VISION_ROUTE");
  });

  test("builds a ChatGPT-facing fallback helper without leaking secrets or base64", () => {
    const fallback = buildVisionAnalysisFallback({
      ok: true,
      has_configured_vision_route: true,
      available_routes: [{
        route: "ollama_local",
        available: true,
        auth: "none",
        model: "hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_M",
        supports_image_input: true,
        evidence: ["OLLAMA_SHOW_CAPABILITIES_VISION"]
      }],
      missing_capabilities: ["MISSING_GEMINI_API_KEY"],
      warnings: ["saw token sk-test12345678901234567890 while testing"]
    });

    const serialized = JSON.stringify(fallback);
    expect(fallback.tool).toBe("repo_write_codex_task");
    expect(fallback.route_status).toBe("ready");
    expect(fallback.preferred_route).toEqual({
      route: "ollama_local",
      model: "hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_M",
      evidence: ["OLLAMA_SHOW_CAPABILITIES_VISION"]
    });
    expect(fallback.payload_notes).toEqual(expect.arrayContaining([
      "Attach the image through repo_write_codex_task.input_assets; the bridge stores it under .chatgpt/codex-runs/<run_id>/inputs/."
    ]));
    expect(serialized).not.toContain("sk-test12345678901234567890");
    expect(serialized).not.toContain("content_base64");
  });

  test("fallback helper reports blocked when no validated image route exists", () => {
    const fallback = buildVisionAnalysisFallback({
      ok: true,
      has_configured_vision_route: false,
      available_routes: [],
      missing_capabilities: ["MISSING_LOCAL_GEMMA_VISION_MODEL", "NO_CONFIGURED_VISION_ROUTE"],
      warnings: []
    });

    expect(fallback.route_status).toBe("blocked");
    expect(fallback.blocked_result_template).toContain("status: blocked");
    expect(fallback.blocked_result_template).toContain("MISSING_LOCAL_GEMMA_VISION_MODEL");
    expect(fallback.blocked_result_template).toContain("NO_CONFIGURED_VISION_ROUTE");
  });
});
