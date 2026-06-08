import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

export const VisionRouteInputSchema = RepoInputSchema;

export const VisionRouteResultSchema = z.object({
  ok: z.literal(true),
  repo_id: z.string(),
  has_configured_vision_route: z.boolean(),
  available_routes: z.array(z.object({
    route: z.enum(["gemini_api", "vertex_gemini", "ollama_local"]),
    available: z.boolean(),
    auth: z.enum(["api_key", "adc", "service_account", "none"]).optional(),
    model: z.string().optional(),
    supports_image_input: z.boolean().optional(),
    evidence: z.array(z.string())
  })),
  missing_capabilities: z.array(z.enum([
    "MISSING_IMAGE_INPUT_ASSET",
    "MISSING_GEMINI_API_KEY",
    "MISSING_VERTEX_AUTH",
    "MISSING_LOCAL_GEMMA_VISION_MODEL",
    "NO_CONFIGURED_VISION_ROUTE"
  ])),
  warnings: z.array(z.string())
});

export type VisionRouteInput = z.infer<typeof VisionRouteInputSchema>;
export type VisionRouteResult = z.infer<typeof VisionRouteResultSchema>;
