import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { RootRegistry } from "../src/services/root-registry.js";
import { agentRunnerStatusHandler, codexReviewHandler, writeCodexTaskHandler } from "../src/tools/handlers.js";
import { createRepoFixture } from "./fixtures/repo-fixture.js";

const execFileAsync = promisify(execFile);

describe("central Codex queue routing", () => {
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
