import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { HermesIntakeService, type HermesIntakeSpawner } from "../src/services/hermes-intake-service.js";

describe("HermesIntakeService", () => {
  test("writes a file-backed Hermes intake packet without submitting by default", async () => {
    const root = await createBridgeFixture();
    const spawns: Array<{ command: string; args: string[]; cwd: string | undefined; shell: boolean | undefined }> = [];
    const service = new HermesIntakeService(root, ((command, args, options) => {
      spawns.push({ command, args, cwd: options.cwd, shell: options.shell });
      throw new Error("dry-run intake should not spawn");
    }) satisfies HermesIntakeSpawner);

    const result = await service.submit({
      repo_id: "shared-agent-bridge",
      title: "Review Hermes handoff",
      job_id: "hermes-handoff-review",
      intake_markdown: "# Roadmap\n\nSend this to Hermes Orchestrator.\n",
      submit: false
    });

    expect(result).toMatchObject({
      ok: true,
      repo_id: "shared-agent-bridge",
      status: "packet_written",
      submitted: false,
      spawned: false,
      job_id: "hermes-handoff-review",
      board: "hermes-intake-hermes-handoff-review",
      target: "hermes-orchestrator",
      manifest_path: "shared/hermes-intake/hermes-handoff-review/manifest.json",
      intake_path: "shared/hermes-intake/hermes-handoff-review/INTAKE.md",
      result_path: "shared/hermes-intake/hermes-handoff-review/RESULT.md"
    });
    expect(result.warnings).toEqual([]);
    expect(spawns).toEqual([]);

    const manifest = JSON.parse(await readFile(join(root, "shared/hermes-intake/hermes-handoff-review/manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      title: "Review Hermes handoff",
      job_id: "hermes-handoff-review",
      mode: "roadmap-to-kanban",
      board: "hermes-intake-hermes-handoff-review",
      target: "hermes-orchestrator",
      skillsmith: true,
      preserve_full_context: true
    });
    await expect(readFile(join(root, "shared/hermes-intake/hermes-handoff-review/INTAKE.md"), "utf8"))
      .resolves.toContain("Send this to Hermes Orchestrator.");
  });

  test("submits the manifest through the guarded PowerShell helper and reads RESULT.md", async () => {
    const root = await createBridgeFixture();
    const service = new HermesIntakeService(root, (async (_command, args, options) => {
      const manifestArg = args.at(-1);
      expect(args.slice(0, 4)).toEqual(["-ExecutionPolicy", "Bypass", "-File", "scripts/submit-hermes-intake.ps1"]);
      expect(manifestArg).toBe("shared/hermes-intake/direct-hermes-review/manifest.json");
      expect(options).toMatchObject({ cwd: root, shell: false });
      await writeRepoFile(root, "shared/hermes-intake/direct-hermes-review/RESULT.md", [
        "board: hermes-intake-direct-hermes-review",
        "orchestrator_task_id: task-orch-001",
        "skillsmith_task_id: task-skill-001"
      ].join("\n"));
      return {
        status: 0,
        signal: null,
        stdout: "submitted\n",
        stderr: ""
      };
    }) satisfies HermesIntakeSpawner);

    const result = await service.submit({
      repo_id: "shared-agent-bridge",
      title: "Direct Hermes review",
      job_id: "direct-hermes-review",
      intake_markdown: "Review this with Hermes.",
      submit: true
    });

    expect(result).toMatchObject({
      ok: true,
      status: "submitted",
      submitted: true,
      spawned: true,
      exit_code: 0,
      result_read: true,
      result_text: expect.stringContaining("orchestrator_task_id: task-orch-001")
    });
  });

  test("rejects unsafe job ids before writing or spawning", async () => {
    const root = await createBridgeFixture();
    let spawnCount = 0;
    const service = new HermesIntakeService(root, (() => {
      spawnCount += 1;
      throw new Error("unsafe intake should not spawn");
    }) satisfies HermesIntakeSpawner);

    await expect(service.submit({
      repo_id: "shared-agent-bridge",
      title: "Bad",
      job_id: "../bad",
      intake_markdown: "bad",
      submit: true
    })).rejects.toThrow(/job_id/i);
    expect(spawnCount).toBe(0);
  });
});

async function createBridgeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hermes-intake-service-"));
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(join(root, "scripts/submit-hermes-intake.ps1"), "param($Manifest)\n", "utf8");
  return root;
}

async function writeRepoFile(root: string, repoPath: string, content: string): Promise<void> {
  const absolutePath = join(root, ...repoPath.split("/"));
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}
