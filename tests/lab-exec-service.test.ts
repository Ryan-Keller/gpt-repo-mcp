import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { LabExecService, type LabExecSpawner } from "../src/services/lab-exec-service.js";

describe("LabExecService", () => {
  test("runs an approved Node lab file without a shell and returns a receipt", async () => {
    const root = await createLabFixture();
    await writeRepoFile(root, "shared/experiments/town-lab-2026-06-13/portal-validator-lab.mjs", "console.log('11 pass / 0 fail');\n");
    const spawns: Array<{ command: string; args: string[]; shell: boolean | undefined; cwd: string | undefined }> = [];
    const service = new LabExecService(root, ((command, args, options) => {
      spawns.push({ command, args, shell: options.shell, cwd: options.cwd });
      return {
        status: 0,
        signal: null,
        stdout: "11 pass / 0 fail\n",
        stderr: ""
      };
    }) satisfies LabExecSpawner);

    const result = await service.run({
      repo_id: "fixture",
      command: "node shared/experiments/town-lab-2026-06-13/portal-validator-lab.mjs",
      timeout_seconds: 5,
      max_output_bytes: 4096
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      allowed: true,
      spawned: true,
      exit_code: 0,
      timed_out: false,
      cwd_label: "repo_root",
      argv: ["node", "shared/experiments/town-lab-2026-06-13/portal-validator-lab.mjs"],
      policy: {
        command_family: "node_lab_file",
        approved_lab_root: "shared/experiments",
        shell: "disabled"
      }
    });
    expect(result.stdout_tail).toContain("11 pass / 0 fail");
    expect(result.output_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(spawns).toEqual([{
      command: "node",
      args: ["shared/experiments/town-lab-2026-06-13/portal-validator-lab.mjs"],
      shell: false,
      cwd: root
    }]);
  });

  test.each([
    "git status",
    "codex exec",
    "npm install",
    "node README.md",
    "node ../outside.mjs",
    "node shared/experiments/town-lab-2026-06-13/portal-validator-lab.mjs && git status",
    "node shared/experiments/town-lab-2026-06-13/portal-validator-lab.mjs > out.txt",
    "node shared/experiments/town-lab-2026-06-13/portal-validator-lab.mjs | tee out.txt",
    "node shared/experiments/town-lab-2026-06-13/portal-validator-lab.mjs &",
    "rm shared/experiments/town-lab-2026-06-13/portal-validator-lab.mjs"
  ])("rejects unsafe command before spawning: %s", async (command) => {
    const root = await createLabFixture();
    await writeRepoFile(root, "shared/experiments/town-lab-2026-06-13/portal-validator-lab.mjs", "console.log('ok');\n");
    let spawnCount = 0;
    const service = new LabExecService(root, (() => {
      spawnCount += 1;
      throw new Error("unsafe command should not spawn");
    }) satisfies LabExecSpawner);

    const result = await service.run({
      repo_id: "fixture",
      command,
      timeout_seconds: 5
    });

    expect(result.allowed).toBe(false);
    expect(result.spawned).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.policy.rejection_reasons.length).toBeGreaterThan(0);
    expect(spawnCount).toBe(0);
  });
});

async function createLabFixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "lab-exec-service-"));
}

async function writeRepoFile(root: string, repoPath: string, content: string): Promise<void> {
  const absolutePath = join(root, ...repoPath.split("/"));
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}
