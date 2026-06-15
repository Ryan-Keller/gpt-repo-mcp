import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

const LabExecPolicySchema = z.object({
  command_family: z.enum(["node_lab_file", "rejected"]).describe("Policy classification for the requested command."),
  approved_lab_root: z.string().describe("Approved repo-relative lab root used for this decision."),
  shell: z.literal("disabled").describe("Shell execution policy. This primitive never uses a shell for allowed commands."),
  timeout_seconds: z.number().describe("Effective execution timeout in seconds."),
  max_output_bytes: z.number().int().describe("Maximum stdout or stderr bytes retained in the receipt."),
  rejection_reasons: z.array(z.string()).describe("Policy reasons that rejected the command before spawning.")
});

export const LabExecInputSchema = RepoInputSchema.extend({
  command: z.string()
    .min(1)
    .max(500)
    .describe("Exact lab command. Only node <repo-relative shared/experiments .mjs/.js file> is accepted."),
  timeout_seconds: z.number()
    .positive()
    .max(30)
    .default(10)
    .describe("Maximum seconds before the lab process is killed."),
  max_output_bytes: z.number()
    .int()
    .positive()
    .max(65536)
    .default(16384)
    .describe("Maximum stdout and stderr bytes retained separately in the receipt.")
});

export const LabExecResultSchema = z.object({
  ok: z.literal(true).describe("True when the lab exec request was handled, including policy rejections."),
  repo_id: z.string().describe("Approved repository id."),
  status: z.enum(["completed", "failed", "timed_out", "rejected"]).describe("Execution or policy result."),
  allowed: z.boolean().describe("Whether policy allowed the command to spawn."),
  spawned: z.boolean().describe("Whether a child process was started."),
  argv: z.array(z.string()).describe("Parsed argv used for execution or rejected by policy."),
  cwd_label: z.literal("repo_root").describe("The child cwd label. The absolute local path is not returned."),
  exit_code: z.number().int().nullable().describe("Process exit code when available."),
  signal: z.string().nullable().describe("Process signal when available."),
  timed_out: z.boolean().describe("Whether timeout killed the child process."),
  duration_ms: z.number().int().nonnegative().describe("Elapsed wall-clock duration in milliseconds."),
  stdout_tail: z.string().describe("Redacted capped stdout tail."),
  stderr_tail: z.string().describe("Redacted capped stderr tail."),
  stdout_truncated: z.boolean().describe("Whether stdout exceeded max_output_bytes."),
  stderr_truncated: z.boolean().describe("Whether stderr exceeded max_output_bytes."),
  output_sha256: z.string().describe("SHA-256 over stdout and stderr bytes observed before redaction."),
  policy: LabExecPolicySchema.describe("Policy receipt for the command decision."),
  warnings: z.array(z.string()).describe("Non-fatal warnings from the lab execution primitive.")
});

export type LabExecInput = z.input<typeof LabExecInputSchema>;
export type LabExecResult = z.infer<typeof LabExecResultSchema>;
