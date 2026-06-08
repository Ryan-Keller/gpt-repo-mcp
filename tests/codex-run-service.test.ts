import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { CodexRunService, type CodexProcess, type CodexSpawner } from "../src/services/codex-run-service.js";

const RUN_ID = "2026-06-07T020000Z-test-codex-run";

describe("CodexRunService", () => {
  test("refuses missing PROMPT.md", async () => {
    const fixture = await createCodexFixture();
    const service = new CodexRunService(fixture.root, failSpawner);

    const result = await service.runAndWait({
      repo_id: "fixture",
      run_id: RUN_ID,
      timeout_seconds: 1
    });

    expect(result).toMatchObject({
      ok: true,
      status: "missing_prompt",
      launched: false,
      timed_out: false,
      result_path: `.chatgpt/codex-runs/${RUN_ID}/RESULT.md`,
      blockers: ["PROMPT.md is missing."],
      warnings: ["CODEX_PROMPT_MISSING"]
    });
  });

  test("returns existing RESULT.md without launching", async () => {
    const fixture = await createCodexFixture();
    await writeRunFile(fixture.root, RUN_ID, "PROMPT.md", "# Prompt\n");
    await writeRunFile(fixture.root, RUN_ID, "RESULT.md", [
      "# CODEX_RESULT",
      "status: completed",
      "summary: already done",
      "blockers:",
      "- none",
      ""
    ].join("\n"));
    const service = new CodexRunService(fixture.root, failSpawner);

    const result = await service.runAndWait({
      repo_id: "fixture",
      run_id: RUN_ID,
      timeout_seconds: 1
    });

    expect(result.status).toBe("existing_result");
    expect(result.launched).toBe(false);
    expect(result.result_text).toContain("already done");
    expect(result.blockers).toEqual(["none"]);
  });

  test("lock behavior refuses a second launch", async () => {
    const fixture = await createCodexFixture();
    await writeRunFile(fixture.root, RUN_ID, "PROMPT.md", "# Prompt\n");
    await writeRunFile(fixture.root, RUN_ID, "RESULT.md.lock", "{}\n");
    const service = new CodexRunService(fixture.root, failSpawner);

    const result = await service.runAndWait({
      repo_id: "fixture",
      run_id: RUN_ID,
      timeout_seconds: 1
    });

    expect(result.status).toBe("locked");
    expect(result.launched).toBe(false);
    expect(result.lock_state).toBe("active");
    expect(result.lock_path).toBe(`.chatgpt/codex-runs/${RUN_ID}/RESULT.md.lock`);
    expect(result.warnings).toContain("CODEX_RUN_LOCK_ACTIVE");
    expect(result.warnings).toContain("CODEX_RUN_LOCK_RECENT_NO_PID");
  });

  test("stale lock reports recovery path without launching", async () => {
    const fixture = await createCodexFixture();
    await writeRunFile(fixture.root, RUN_ID, "PROMPT.md", "# Prompt\n");
    await writeRunFile(fixture.root, RUN_ID, "RESULT.md.lock", JSON.stringify({
      repo_id: "fixture",
      run_id: RUN_ID,
      created_at: "2026-06-07T00:00:00.000Z"
    }));
    await makeRunFileOld(fixture.root, RUN_ID, "RESULT.md.lock");
    const service = new CodexRunService(fixture.root, failSpawner);

    const result = await service.runAndWait({
      repo_id: "fixture",
      run_id: RUN_ID,
      timeout_seconds: 1,
      stale_lock_seconds: 1
    });

    expect(result.status).toBe("stale_lock");
    expect(result.launched).toBe(false);
    expect(result.lock_state).toBe("stale");
    expect(result.blockers.join("\n")).toContain("recover_stale_lock: true");
    expect(result.warnings).toContain("CODEX_RUN_LOCK_STALE");
  });

  test("recover_stale_lock removes only stale lock and launches", async () => {
    const fixture = await createCodexFixture();
    await writeRunFile(fixture.root, RUN_ID, "PROMPT.md", "# Prompt\n");
    await writeRunFile(fixture.root, RUN_ID, "RESULT.md.lock", JSON.stringify({
      repo_id: "fixture",
      run_id: RUN_ID,
      created_at: "2026-06-07T00:00:00.000Z"
    }));
    await makeRunFileOld(fixture.root, RUN_ID, "RESULT.md.lock");
    const fake = createFakeProcess();
    const service = new CodexRunService(fixture.root, () => {
      setTimeout(async () => {
        await writeRunFile(fixture.root, RUN_ID, "RESULT.md", "status: completed\nblockers:\n- none\n");
        fake.exit(0);
      }, 1);
      return fake.process;
    });

    const result = await service.runAndWait({
      repo_id: "fixture",
      run_id: RUN_ID,
      timeout_seconds: 2,
      recover_stale_lock: true,
      stale_lock_seconds: 1
    });

    expect(result.status).toBe("completed");
    expect(result.launched).toBe(true);
    expect(result.lock_state).toBe("recovered");
    expect(result.result_text).toContain("completed");
  });

  test("recover_stale_lock does not remove active pid lock", async () => {
    const fixture = await createCodexFixture();
    await writeRunFile(fixture.root, RUN_ID, "PROMPT.md", "# Prompt\n");
    const lockText = JSON.stringify({
      repo_id: "fixture",
      run_id: RUN_ID,
      created_at: "2026-06-07T00:00:00.000Z",
      pid: process.pid
    });
    await writeRunFile(fixture.root, RUN_ID, "RESULT.md.lock", lockText);
    await makeRunFileOld(fixture.root, RUN_ID, "RESULT.md.lock");
    const service = new CodexRunService(fixture.root, failSpawner);

    const result = await service.runAndWait({
      repo_id: "fixture",
      run_id: RUN_ID,
      timeout_seconds: 1,
      recover_stale_lock: true,
      stale_lock_seconds: 1
    });

    expect(result.status).toBe("locked");
    expect(result.launched).toBe(false);
    expect(result.lock_state).toBe("active");
    expect(result.warnings).toContain("CODEX_RUN_LOCK_ACTIVE");
    await expect(readFile(runFilePath(fixture.root, RUN_ID, "RESULT.md.lock"), "utf8")).resolves.toBe(lockText);
  });

  test("timeout returns timed_out with useful log tails", async () => {
    const fixture = await createCodexFixture();
    await writeRunFile(fixture.root, RUN_ID, "PROMPT.md", "# Prompt\n");
    const fake = createFakeProcess();
    const service = new CodexRunService(fixture.root, () => {
      setTimeout(() => {
        fake.stdout.write("still working\n");
        fake.stderr.write("diagnostic line\n");
      }, 1);
      return fake.process;
    });

    const result = await service.runAndWait({
      repo_id: "fixture",
      run_id: RUN_ID,
      timeout_seconds: 0.01
    });

    expect(result.status).toBe("timed_out");
    expect(result.timed_out).toBe(true);
    expect(result.launched).toBe(true);
    expect(result.stdout_tail).toContain("still working");
    expect(result.stderr_tail).toContain("diagnostic line");
    expect(fake.killed).toBe(true);
  });

  test("mocked successful Codex execution waits for RESULT.md", async () => {
    const fixture = await createCodexFixture();
    await writeRunFile(fixture.root, RUN_ID, "PROMPT.md", "# Prompt\n");
    let receivedCommand: string | undefined;
    let receivedArgs: string[] | undefined;
    const fake = createFakeProcess();
    const service = new CodexRunService(fixture.root, ((command, args) => {
      receivedCommand = command;
      receivedArgs = args;
      setTimeout(async () => {
        fake.stdout.write("codex stdout\n");
        fake.stderr.write("codex stderr\n");
        await writeRunFile(fixture.root, RUN_ID, "RESULT.md", [
          "# CODEX_RESULT",
          "status: completed",
          "summary: finished",
          "blockers:",
          "- none",
          ""
        ].join("\n"));
        fake.exit(0);
      }, 1);
      return fake.process;
    }) satisfies CodexSpawner);

    const result = await service.runAndWait({
      repo_id: "fixture",
      run_id: RUN_ID,
      timeout_seconds: 2
    });

    expect(receivedCommand).toBe("npx");
    expect(receivedArgs).toEqual([
      "--no-install",
      "@openai/codex",
      "exec",
      "-"
    ]);
    expect(fake.stdinText()).toBe(`Implement .chatgpt/codex-runs/${RUN_ID}/PROMPT.md\n`);
    expect(result.status).toBe("completed");
    expect(result.launched).toBe(true);
    expect(result.result_text).toContain("finished");
    expect(result.stdout_tail).toContain("codex stdout");
    expect(result.stderr_tail).toContain("codex stderr");
  });

  test("stdout and stderr tails are captured on process failure", async () => {
    const fixture = await createCodexFixture();
    await writeRunFile(fixture.root, RUN_ID, "PROMPT.md", "# Prompt\n");
    const fake = createFakeProcess();
    const service = new CodexRunService(fixture.root, () => {
      setTimeout(() => {
        fake.stdout.write("stdout before failure\n");
        fake.stderr.write("stderr before failure\n");
        fake.exit(2);
      }, 1);
      return fake.process;
    });

    const result = await service.runAndWait({
      repo_id: "fixture",
      run_id: RUN_ID,
      timeout_seconds: 2
    });

    expect(result.status).toBe("failed");
    expect(result.stdout_tail).toContain("stdout before failure");
    expect(result.stderr_tail).toContain("stderr before failure");
    expect(result.blockers[0]).toContain("Codex exited before RESULT.md appeared");
  });
});

async function writeRunFile(root: string, runId: string, name: string, content: string): Promise<void> {
  const path = runFilePath(root, runId, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function makeRunFileOld(root: string, runId: string, name: string): Promise<void> {
  const oldDate = new Date(Date.now() - 60_000);
  await utimes(runFilePath(root, runId, name), oldDate, oldDate);
}

function runFilePath(root: string, runId: string, name: string): string {
  return join(root, ".chatgpt", "codex-runs", runId, name);
}

async function createCodexFixture(): Promise<{ root: string }> {
  const root = await mkdtemp(join(tmpdir(), "codex-run-service-"));
  await mkdir(join(root, ".chatgpt", "codex-runs"), { recursive: true });
  return { root };
}

function createFakeProcess(): {
  process: CodexProcess;
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  stdinText: () => string;
  killed: boolean;
  exit: (code: number) => void;
} {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  let stdinText = "";
  stdin.on("data", (chunk) => {
    stdinText += chunk.toString();
  });
  const fake: {
    process: CodexProcess;
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    stdinText: () => string;
    killed: boolean;
    exit: (code: number) => void;
  } = {
    killed: false,
    process: {
      stdout,
      stderr,
      stdin,
      kill: () => {
        fake.killed = true;
        return true;
      },
      once: (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => {
        events.once(event, listener);
        return fake.process;
      }
    },
    stdout,
    stderr,
    stdin,
    stdinText: () => stdinText,
    exit: (code: number) => {
      events.emit("exit", code, null);
    }
  };
  return fake;
}

const failSpawner: CodexSpawner = () => {
  throw new Error("Spawner should not be called.");
};
