import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { RootRegistry } from "../src/services/root-registry.js";
import { toHermesWorkspace } from "../src/services/hermes-intake-service.js";
import { hermesIntakeHandler } from "../src/tools/handlers.js";

describe("hermesIntakeHandler", () => {
  test("writes target-project work into the bridge-owned intake lane", async () => {
    const bridgeRoot = await mkdtemp(join(tmpdir(), "hermes-intake-bridge-"));
    const targetRoot = await mkdtemp(join(tmpdir(), "hermes-intake-target-"));
    await mkdir(join(bridgeRoot, "shared", "hermes-intake"), { recursive: true });

    const registry = await RootRegistry.fromConfig({
      repos: [
        {
          repo_id: "shared-agent-bridge",
          display_name: "Shared Agent Bridge",
          root: bridgeRoot,
          writes: { enabled: true, allowed_globs: ["shared/hermes-intake/**"] }
        },
        {
          repo_id: "bridge-field-console",
          display_name: "Bridge Field Console",
          root: targetRoot,
          writes: { enabled: false, allowed_globs: [] }
        }
      ],
      limits: {}
    });

    const result = await hermesIntakeHandler({
      repo_id: "bridge-field-console",
      title: "Project Advisors",
      job_id: "project-advisors-handler-test",
      intake_markdown: "# Project Advisors\n",
      submit: false
    }, { registry });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      repo_id: "bridge-field-console",
      status: "packet_written",
      workspace: expect.stringMatching(/^dir:/),
      manifest_path: "shared/hermes-intake/project-advisors-handler-test/manifest.json"
    });
    const manifest = JSON.parse(await readFile(
      join(bridgeRoot, "shared", "hermes-intake", "project-advisors-handler-test", "manifest.json"),
      "utf8"
    ));
    expect(manifest.workspace).toBe(toHermesWorkspace(targetRoot));
    await expect(readFile(
      join(bridgeRoot, "shared", "hermes-intake", "project-advisors-handler-test", "INTAKE.md"),
      "utf8"
    )).resolves.toContain("Project Advisors");
    await expect(readFile(
      join(targetRoot, "shared", "hermes-intake", "project-advisors-handler-test", "INTAKE.md"),
      "utf8"
    )).rejects.toMatchObject({ code: "ENOENT" });
  });
});
