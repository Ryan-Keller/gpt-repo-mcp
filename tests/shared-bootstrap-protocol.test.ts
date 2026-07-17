import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const protocolPath = fileURLToPath(new URL("../../shared/handoffs/SHARED_AGENT_BRIDGE_BOOTSTRAP_PROTOCOL.md", import.meta.url));

describe.skipIf(!existsSync(protocolPath))("Shared Agent Bridge bootstrap source protocol", () => {
  test("documents runner-status fallback without pretending markdown exposes tools", () => {
    const text = readFileSync(protocolPath, "utf8");

    expect(text).toContain("repo_runner_status");
    expect(text).toContain("codex_run_and_wait");
    expect(text).toContain("review_only: true");
    expect(text).toContain("connector/tool catalog not exposed");
    expect(text).toMatch(/Markdown source files can guide behavior, but they cannot force the\s+platform to expose tools\./);
  });
});
