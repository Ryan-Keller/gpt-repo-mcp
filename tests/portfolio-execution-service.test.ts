import { describe, expect, it } from "vitest";
import { PortfolioExecutionService } from "../src/services/portfolio-execution-service.js";

const request = {
  target_repo_id: "live-surface",
  objective: "Verify the current Live Surface project state and return evidence.",
  allowed_paths: [],
  proof_boundary: "Read-only onboarding and runtime evidence with a receipt.",
  work_type: "knowledge" as const,
  satisfaction_gate: 95,
  consent_granted: true as const
};

describe("PortfolioExecutionService", () => {
  it("returns stable Hermes watch identities from the installed launcher receipt", async () => {
    const service = new PortfolioExecutionService({
      now: () => new Date("2026-07-16T16:30:00.000Z"),
      spawnLaunch: async (_command, args) => {
        expect(args).toContain("-ConsentGranted");
        expect(args).toContain("-SkipDesktopReturnDelivery");
        expect(args).not.toContain("-AllowedPaths");
        return {
          exitCode: 0,
          timedOut: false,
          stderr: "",
          stdout: JSON.stringify({
            kind: "hermes-off-thread-started",
            transaction: {
              transaction_id: "offthread-0123456789abcdef",
              board: "offthread-live-surface",
              task_id: "t_12345678",
              transaction_path: "D:\\HermesDesktop\\workspace\\handoff\\off-thread\\offthread-0123456789abcdef\\transaction.json",
              satisfaction_gate: 95,
              operator_status: "Hermes is working."
            }
          })
        };
      }
    });

    const receipt = await service.launch({
      repo_id: "shared-agent-bridge", action_id: "a_1234567890", target_repo_id: "live-surface",
      target_repo_root: "M:\\live-surface", execution: request
    });

    expect(receipt).toMatchObject({
      ok: true, status: "started", transaction_id: "offthread-0123456789abcdef",
      board: "offthread-live-surface", task_id: "t_12345678", satisfaction_gate: 95,
      next_action: "watch_repo_hermes_transaction_with_repo_hermes_watch"
    });
    expect(receipt.goal_id).toMatch(/^goal-[a-f0-9]{16}$/);
  });

  it("fails closed when readiness blocks before a transaction is created", async () => {
    const service = new PortfolioExecutionService({
      spawnLaunch: async () => ({
        exitCode: 0, timedOut: false, stderr: "",
        stdout: JSON.stringify({
          kind: "hermes-off-thread-readiness-blocked",
          transaction_id: "offthread-fedcba9876543210",
          operator_status: "Stopped before dispatch; required job-site capabilities are missing.",
          plan: { transaction_id: "offthread-fedcba9876543210", board: "offthread-live-surface" }
        })
      })
    });
    const receipt = await service.launch({
      repo_id: "shared-agent-bridge", action_id: "a_blocked", target_repo_id: "live-surface",
      target_repo_root: "M:\\live-surface", execution: request
    });
    expect(receipt).toMatchObject({ ok: false, status: "readiness_blocked", transaction_id: "offthread-fedcba9876543210" });
    expect(receipt.warnings).toContain("HERMES_JOB_SITE_READINESS_BLOCKED");
  });

  it("reports launcher timeout without inventing a transaction", async () => {
    const service = new PortfolioExecutionService({
      spawnLaunch: async () => ({ exitCode: null, timedOut: true, stdout: "", stderr: "" })
    });
    const receipt = await service.launch({
      repo_id: "shared-agent-bridge", action_id: "a_timeout", target_repo_id: "live-surface",
      target_repo_root: "M:\\live-surface", execution: request
    });
    expect(receipt).toMatchObject({ ok: false, status: "timed_out", transaction_id: "" });
  });
});
