import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { RootRegistry } from "../src/services/root-registry.js";
import { agentRunnerStatusHandler, codexReviewHandler, portfolioActionCommandHandler, writeCodexTaskHandler } from "../src/tools/handlers.js";
import { createRepoFixture } from "./fixtures/repo-fixture.js";

const execFileAsync = promisify(execFile);

describe("central Codex queue routing", () => {
  test("Field Console direct review decisions record operator intent and queue Codex follow-up", async () => {
    const bridge = await createRepoFixture();
    const target = await createRepoFixture();
    const context = {
      registry: await RootRegistry.fromConfig({
        repos: [
          {
            repo_id: "shared-agent-bridge",
            display_name: "Shared Agent Bridge",
            root: bridge.root,
            writes: { enabled: true, allowed_globs: [".chatgpt/**"] }
          },
          {
            repo_id: "bridge-field-console",
            display_name: "Bridge Field Console",
            root: target.root,
            writes: { enabled: true, allowed_globs: [".chatgpt/**"] },
            operations: { enabled: true }
          }
        ],
        limits: {}
      })
    };

    const result = await portfolioActionCommandHandler({
      repo_id: "shared-agent-bridge",
      operation: "update_goal",
      actions: [],
      reason: "Field Console NO review decision.",
      goal: {
        goal_id: "goal-field-review-test",
        idempotency_key: "field-console:goal-field-review-test",
        project_id: "bridge-field-console",
        project_name: "Bridge Field Console",
        repository_id: "bridge-field-console",
        action_id: "field-review-test",
        objective: "Resolve an under-threshold direct Codex review packet.",
        source_kind: "field_console",
        source_reference: "field-console-test",
        plan: ["Make the packet actionable."],
        dependencies: [],
        parallel_wave: 0,
        serial_after: [],
        executor: "codex",
        routing_reason: "Direct Codex work needs a Field Console review route.",
        execution_scope: ["App.tsx", "src/**"],
        privacy_scope: "private_tailnet",
        proof_boundary: "Typecheck and provide a clear RESULT.md.",
        codex_arbiter: "Codex",
        satisfaction_threshold: 95,
        satisfaction_score: 76,
        iteration: 2,
        unmet_dimensions: ["The review packet does not say what to do next."],
        evidence: [],
        artifacts: [],
        changed_files: []
      },
      goal_review: {
        decision: "no",
        instruction: "Replace this with one smaller field-actionable next move.",
        requested_by: "field_console",
        create_codex_followup: true
      }
    }, context);
    const data = result.structuredContent as {
      goal_records?: Array<{ events: Array<{ source: string; event_type: string }>; intervention: string }>;
      codex_followup_receipts?: Array<{ queued: boolean; run_id: string; prompt_path: string; queue_repo_id: string; target_repo_id: string }>;
      next_action: string;
    };

    expect(data.goal_records?.[0]?.events.at(-1)).toMatchObject({ source: "operator", event_type: "field_review_no" });
    expect(data.goal_records?.[0]?.intervention).toBe("Replace this with one smaller field-actionable next move.");
    expect(data.codex_followup_receipts?.[0]).toMatchObject({
      queued: true,
      queue_repo_id: "shared-agent-bridge",
      target_repo_id: "bridge-field-console"
    });
    const prompt = await readFile(join(bridge.root, data.codex_followup_receipts![0]!.prompt_path), "utf8");
    expect(prompt).toContain("Field Console review decision: NO.");
    expect(prompt).toContain("Target repo_id: bridge-field-console");
    await expect(readFile(join(target.root, data.codex_followup_receipts![0]!.prompt_path), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(data.next_action).toContain("codex_followup_queued");
  });

  test("project Codex tasks are queued in shared-agent-bridge and reviewed against the target repo", async () => {
    const bridge = await createRepoFixture();
    const target = await createMinimalGitFixture();
    await git(target.root, ["init"]);
    await git(target.root, ["config", "user.email", "test@example.com"]);
    await git(target.root, ["config", "user.name", "Test User"]);
    await git(target.root, ["add", "--", "src/app.ts"]);
    await git(target.root, ["commit", "-m", "initial"]);

    const context = {
      registry: await RootRegistry.fromConfig({
        repos: [
          {
            repo_id: "shared-agent-bridge",
            display_name: "Shared Agent Bridge",
            root: bridge.root,
            writes: { enabled: true, allowed_globs: [".chatgpt/**"] }
          },
          {
            repo_id: "word-link-lab",
            display_name: "Word Link Lab",
            root: target.root,
            writes: { enabled: true, allowed_globs: [".chatgpt/**"] },
            operations: { enabled: true }
          }
        ],
        limits: {}
      })
    };

    const writeResult = await writeCodexTaskHandler({
      repo_id: "word-link-lab",
      title: "Probe lab runner",
      objective: "Update the lab runner probe.",
      run_id: "2026-06-15T040000Z-probe-lab-runner"
    }, context);
    const writeData = writeResult.structuredContent as {
      repo_id: string;
      queue_repo_id: string;
      prompt_path: string;
      result_path: string;
      warnings: string[];
    };

    expect(writeData.repo_id).toBe("word-link-lab");
    expect(writeData.queue_repo_id).toBe("shared-agent-bridge");
    await expect(readFile(join(bridge.root, writeData.prompt_path), "utf8")).resolves.toContain("Target repo_id: word-link-lab");
    await expect(readFile(join(target.root, writeData.prompt_path), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(writeData.warnings).toContainEqual(expect.stringContaining("CODEX_CENTRAL_QUEUE"));

    await writeFile(join(target.root, "src", "app.ts"), "export const targetChanged = true;\n");
    await mkdir(dirname(join(bridge.root, writeData.result_path)), { recursive: true });
    await writeFile(join(bridge.root, writeData.result_path), [
      "# CODEX_RESULT",
      "status: completed",
      "summary: Updated lab runner probe.",
      "changed_files:",
      "- src/app.ts",
      ""
    ].join("\n"));

    const reviewResult = await codexReviewHandler({
      repo_id: "word-link-lab",
      run_id: "2026-06-15T040000Z-probe-lab-runner"
    }, context);
    const reviewData = reviewResult.structuredContent as {
      repo_id: string;
      queue_repo_id: string;
      result_found: boolean;
      git_review?: { changed_paths: Array<{ path: string }> };
    };

    expect(reviewData.repo_id).toBe("word-link-lab");
    expect(reviewData.queue_repo_id).toBe("shared-agent-bridge");
    expect(reviewData.result_found).toBe(true);
    expect(reviewData.git_review?.changed_paths.map((entry) => entry.path)).toContain("src/app.ts");
  });

  test("goal lane Codex tasks register a Field Console-visible setup goal", async () => {
    const bridge = await createRepoFixture();
    const context = {
      registry: await RootRegistry.fromConfig({
        repos: [
          {
            repo_id: "shared-agent-bridge",
            display_name: "Shared Agent Bridge",
            root: bridge.root,
            writes: { enabled: true, allowed_globs: [".chatgpt/**"] }
          }
        ],
        limits: {}
      })
    };

    const writeResult = await writeCodexTaskHandler({
      repo_id: "shared-agent-bridge",
      title: "Create Goblin Telecom repo",
      objective: "Create the Goblin Telecom repo, onboarding, bridge fixture, first playable slice, and acceptance receipt.",
      allowed_paths: ["shared/**", "projects/**"],
      acceptance_criteria: ["Repo exists and onboarding is present.", "Satisfaction gate is 95%."],
      run_id: "2026-07-19T210000Z-create-goblin-telecom",
      goal_lane: {
        enabled: true,
        goal_id: "goal-goblin-telecom-bootstrap",
        goal_title: "Goblin Telecom bootstrap",
        project_id: "goblin-telecom",
        project_name: "Goblin Telecom",
        satisfaction_threshold: 95,
        mode: "goal",
        origin: "repo_write_codex_task",
        status_policy: "compact"
      }
    }, context);
    const data = writeResult.structuredContent as { warnings: string[] };
    expect(data.warnings).toContain("GOAL_LANE_REGISTERED_FOR_FIELD_CONSOLE");

    const store = JSON.parse(await readFile(join(bridge.root, ".chatgpt", "goal-records-v1.json"), "utf8")) as {
      goals: Array<{ goal_id: string; project_id: string; project_name: string; state: string; satisfaction_threshold: number; unmet_dimensions: string[] }>;
    };
    expect(store.goals[0]).toMatchObject({
      goal_id: "goal-goblin-telecom-bootstrap",
      project_id: "goblin-telecom",
      project_name: "Goblin Telecom",
      state: "working",
      satisfaction_threshold: 95
    });
    expect(store.goals[0]?.unmet_dimensions).toContain("Waiting for Codex result and satisfaction determination.");
  });

  test("project runner status reports central queue coverage instead of requiring a per-project runner", async () => {
    const bridge = await createRepoFixture();
    const target = await createRepoFixture();
    await mkdir(join(bridge.root, "projects/agent-runner/reports"), { recursive: true });
    await writeFile(join(bridge.root, "projects/agent-runner/reports/runner-heartbeat.json"), JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      status: "polling",
      active_run_id: "",
      runner: "projects/agent-runner/agent_runner.py",
      pid: process.pid,
      max_parallel_runs: 20,
      worker_slots: []
    }));

    const context = {
      registry: await RootRegistry.fromConfig({
        repos: [
          {
            repo_id: "shared-agent-bridge",
            display_name: "Shared Agent Bridge",
            root: bridge.root,
            writes: { enabled: true, allowed_globs: [".chatgpt/**"] }
          },
          {
            repo_id: "word-link-lab",
            display_name: "Word Link Lab",
            root: target.root,
            writes: { enabled: true, allowed_globs: [".chatgpt/**"] },
            operations: { enabled: true }
          }
        ],
        limits: {}
      })
    };

    const result = await agentRunnerStatusHandler({
      repo_id: "word-link-lab"
    }, context);
    const data = result.structuredContent as {
      repo_id: string;
      runner: string;
      worker: string;
      central_queue?: {
        enabled: boolean;
        target_repo_id: string;
        queue_repo_id: string;
        project_runner_required: boolean;
        status: string;
      };
      plain_text: string;
    };

    expect(data.repo_id).toBe("word-link-lab");
    expect(data.runner).toBe("alive");
    expect(data.worker).toBe("running");
    expect(data.central_queue).toMatchObject({
      enabled: true,
      target_repo_id: "word-link-lab",
      queue_repo_id: "shared-agent-bridge",
      project_runner_required: false,
      status: "covered_by_central_runner"
    });
    expect(data.plain_text).toContain("project_runner_required=no");
    expect(data.plain_text).toContain("Do not infer project runner offline");
  });
});

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  return stdout;
}

async function createMinimalGitFixture() {
  const root = await mkdtemp(join(tmpdir(), "central-queue-target-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const original = true;\n");
  return { root };
}
