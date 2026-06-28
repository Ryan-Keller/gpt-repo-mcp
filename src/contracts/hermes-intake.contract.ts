import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

const JobIdSchema = z.string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Use a lowercase slug with letters, numbers, and dashes.");

export const HermesIntakeInputSchema = RepoInputSchema.extend({
  title: z.string()
    .min(3)
    .max(200)
    .describe("Human-readable Hermes roadmap or work title."),
  job_id: JobIdSchema
    .describe("Stable lowercase slug used as shared/hermes-intake/<job_id>."),
  intake_markdown: z.string()
    .min(1)
    .max(200000)
    .describe("Full Markdown payload to preserve for Hermes Orchestrator. Do not include secrets, tokens, or private connector URLs."),
  board: z.string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    .optional()
    .describe("Optional Hermes board slug. Defaults to hermes-intake-<job_id>."),
  submit: z.boolean()
    .optional()
    .describe("When true, run the guarded local submit helper. When false, only write the file-backed packet."),
  timeout_seconds: z.number()
    .positive()
    .max(120)
    .optional()
    .describe("Maximum seconds to wait for the local submit helper when submit is true."),
  max_output_bytes: z.number()
    .int()
    .positive()
    .max(65536)
    .optional()
    .describe("Maximum stdout and stderr bytes retained separately from the submit helper.")
});

export const HermesIntakeResultSchema = z.object({
  ok: z.boolean().describe("True when the intake request was handled."),
  repo_id: z.string().describe("Repository id that owns the bridge intake packet."),
  status: z.enum(["packet_written", "submitted", "failed", "timed_out"]).describe("Packet and submit outcome."),
  job_id: z.string().describe("Stable intake job id."),
  board: z.string().describe("Hermes board slug requested in the manifest."),
  target: z.string().describe("Hermes intake target profile."),
  manifest_path: z.string().describe("Repo-relative manifest path."),
  intake_path: z.string().describe("Repo-relative INTAKE.md path."),
  result_path: z.string().describe("Repo-relative RESULT.md path."),
  submitted: z.boolean().describe("Whether the submit helper was requested."),
  spawned: z.boolean().describe("Whether the submit helper process was started."),
  exit_code: z.number().int().describe("Submit helper exit code, or -1 when no process exit code is available."),
  timed_out: z.boolean().describe("Whether timeout killed the submit helper."),
  duration_ms: z.number().int().nonnegative().describe("Elapsed wall-clock duration in milliseconds."),
  stdout_tail: z.string().describe("Redacted capped stdout tail from the submit helper."),
  stderr_tail: z.string().describe("Redacted capped stderr tail from the submit helper."),
  result_read: z.boolean().describe("Whether RESULT.md was available and read after submit or packet write."),
  result_text: z.string().describe("Redacted RESULT.md text when available."),
  warnings: z.array(z.string()).describe("Non-fatal warnings and caveats.")
});

export type HermesIntakeInput = z.input<typeof HermesIntakeInputSchema>;
export type HermesIntakeResult = z.infer<typeof HermesIntakeResultSchema>;
