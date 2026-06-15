import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";

const TOWN_PORTAL_LAB_ROOT = process.env.TOWN_PORTAL_LAB_ROOT
  ? pathToFileURL(process.env.TOWN_PORTAL_LAB_ROOT.endsWith("/") ? process.env.TOWN_PORTAL_LAB_ROOT : `${process.env.TOWN_PORTAL_LAB_ROOT}/`)
  : new URL("../../../town-portal-lab/", import.meta.url);

const LAB_ROUTE_MODULE = new URL(
  "shared/experiments/town-lab-2026-06-13/portal-return-lab-route.mjs",
  TOWN_PORTAL_LAB_ROOT
).href;

type LabRouteModule = {
  SEMANTIC_HASH: string;
  STRICT_HASH: string;
  cloneDefaultTownPortal: () => Record<string, any>;
  cloneDefaultTownPortalPayload: () => Record<string, any>;
  createTownPortalReturnLabRoute: (options: {
    adapter: (handoff: Record<string, any>) => Promise<Record<string, any>> | Record<string, any>;
  }) => {
    returnToTownPortal: (input: {
      portal: Record<string, any> | null;
      payload: Record<string, any>;
      currentStateHash: string;
      turnId: string;
    }) => Promise<Record<string, any>>;
  };
};

const STRESS_HARNESS_MODULE = new URL(
  "shared/experiments/town-lab-2026-06-13/portal-stress-harness.mjs",
  TOWN_PORTAL_LAB_ROOT
).href;

type StressHarnessModule = {
  runPortalReturnStressHarness: (options?: { repoRoot?: string }) => Promise<{
    pass_count: number;
    fail_count: number;
    case_count: number;
    cases: Array<Record<string, any>>;
    risk_notes: string[];
  }>;
};

async function loadLabRoute(): Promise<LabRouteModule> {
  return import(LAB_ROUTE_MODULE) as Promise<LabRouteModule>;
}

async function loadStressHarness(): Promise<StressHarnessModule> {
  return import(STRESS_HARNESS_MODULE) as Promise<StressHarnessModule>;
}

describe("town portal return lab route", () => {
  beforeAll(async () => {
    await access(new URL(LAB_ROUTE_MODULE));
    await access(new URL(STRESS_HARNESS_MODULE));
  });

  test("hands accepted returns to the lab display adapter only after validator acceptance", async () => {
    const lab = await loadLabRoute();
    const adapterCalls: Record<string, any>[] = [];
    const route = lab.createTownPortalReturnLabRoute({
      adapter: async (handoff) => {
        adapterCalls.push(handoff);
        return {
          kind: "town_portal_lab_display_receipt",
          wrote: true,
          artifact_path: "shared/experiments/town-lab-2026-06-13/happy-path.md",
        };
      },
    });

    const result = await route.returnToTownPortal({
      portal: lab.cloneDefaultTownPortal(),
      payload: lab.cloneDefaultTownPortalPayload(),
      currentStateHash: lab.SEMANTIC_HASH,
      turnId: "turn-001",
    });

    expect(result).toMatchObject({
      kind: "town_portal_return_lab_route_result",
      status: "accepted",
      reason: "accepted_once",
      adapter_called: true,
      adapter_receipt: {
        kind: "town_portal_lab_display_receipt",
        wrote: true,
      },
    });
    expect(adapterCalls).toEqual([{
      repo_id: "shared-agent-bridge",
      target_path: "shared/experiments/town-lab-2026-06-13/happy-path.md",
      operation: "write_observation",
      payload_kind: "bridge_status_lab_note",
      body: "Lab note payload. In production this would be handed to the lower-level write only after acceptance.",
    }]);
  });

  test.each([
    ["expired portal", (portal: Record<string, any>, payload: Record<string, any>) => { portal.expires_turn_id = "turn-000"; }, "expired", "portal_expired"],
    ["target mismatch", (_portal: Record<string, any>, payload: Record<string, any>) => { payload.target_path = "shared/experiments/town-lab-2026-06-13/wrong-target.md"; }, "rejected", "target_path_mismatch"],
    ["unsafe operation", (_portal: Record<string, any>, payload: Record<string, any>) => { payload.operation = "launch_agent"; }, "rejected", "operation_mismatch"],
    ["wrong payload kind", (_portal: Record<string, any>, payload: Record<string, any>) => { payload.kind = "arbitrary_note"; }, "rejected", "payload_kind_mismatch"],
    ["display-only violation", (_portal: Record<string, any>, payload: Record<string, any>) => { payload.display_only = false; }, "rejected", "display_only_required"],
  ])("rejects %s before any lab adapter handoff", async (_name, mutate, expectedStatus, expectedReason) => {
    const lab = await loadLabRoute();
    let adapterCalls = 0;
    const route = lab.createTownPortalReturnLabRoute({
      adapter: () => {
        adapterCalls += 1;
        throw new Error("rejected returns must not reach the adapter");
      },
    });
    const portal = lab.cloneDefaultTownPortal();
    const payload = lab.cloneDefaultTownPortalPayload();
    mutate(portal, payload);

    const result = await route.returnToTownPortal({
      portal,
      payload,
      currentStateHash: lab.SEMANTIC_HASH,
      turnId: "turn-001",
    });

    expect(result).toMatchObject({
      status: expectedStatus,
      reason: expectedReason,
      adapter_called: false,
    });
    expect(adapterCalls).toBe(0);
  });

  test("reports state hash conflicts before any lab adapter handoff", async () => {
    const lab = await loadLabRoute();
    let adapterCalls = 0;
    const route = lab.createTownPortalReturnLabRoute({
      adapter: () => {
        adapterCalls += 1;
        throw new Error("conflicts must not reach the adapter");
      },
    });

    const result = await route.returnToTownPortal({
      portal: lab.cloneDefaultTownPortal(),
      payload: lab.cloneDefaultTownPortalPayload(),
      currentStateHash: lab.STRICT_HASH,
      turnId: "turn-001",
    });

    expect(result).toMatchObject({
      status: "conflict",
      reason: "source_observation_changed",
      adapter_called: false,
      conflict: {
        kind: "town_portal_conflict",
        next: "refresh_state",
      },
    });
    expect(adapterCalls).toBe(0);
  });

  test("consumes an accepted portal once and blocks the second return before handoff", async () => {
    const lab = await loadLabRoute();
    let adapterCalls = 0;
    const route = lab.createTownPortalReturnLabRoute({
      adapter: () => {
        adapterCalls += 1;
        return { kind: "town_portal_lab_display_receipt", wrote: true };
      },
    });
    const portal = lab.cloneDefaultTownPortal();

    const first = await route.returnToTownPortal({
      portal,
      payload: lab.cloneDefaultTownPortalPayload(),
      currentStateHash: lab.SEMANTIC_HASH,
      turnId: "turn-001",
    });
    const second = await route.returnToTownPortal({
      portal,
      payload: lab.cloneDefaultTownPortalPayload(),
      currentStateHash: lab.SEMANTIC_HASH,
      turnId: "turn-001",
    });

    expect(first.status).toBe("accepted");
    expect(second).toMatchObject({
      status: "rejected",
      reason: "portal_already_consumed",
      adapter_called: false,
    });
    expect(adapterCalls).toBe(1);
  });

  test("returns a structured adapter_refused result and consumes the handle", async () => {
    const lab = await loadLabRoute();
    let adapterCalls = 0;
    const route = lab.createTownPortalReturnLabRoute({
      adapter: async () => {
        adapterCalls += 1;
        throw new Error("lab adapter refused handoff");
      },
    });
    const portal = lab.cloneDefaultTownPortal();

    const first = await route.returnToTownPortal({
      portal,
      payload: lab.cloneDefaultTownPortalPayload(),
      currentStateHash: lab.SEMANTIC_HASH,
      turnId: "turn-001",
    });
    const second = await route.returnToTownPortal({
      portal,
      payload: lab.cloneDefaultTownPortalPayload(),
      currentStateHash: lab.SEMANTIC_HASH,
      turnId: "turn-001",
    });

    expect(first).toMatchObject({
      status: "rejected",
      reason: "adapter_refused",
      terminal: true,
      consume_handle: true,
      adapter_called: true,
      adapter_error: {
        message: "lab adapter refused handoff",
      },
    });
    expect(second).toMatchObject({
      status: "rejected",
      reason: "portal_already_consumed",
      adapter_called: false,
    });
    expect(adapterCalls).toBe(1);
  });

  test("concurrent same-handle returns accept exactly once", async () => {
    const lab = await loadLabRoute();
    let adapterCalls = 0;
    let releaseAdapter!: () => void;
    const adapterStarted = new Promise<void>((resolve) => {
      releaseAdapter = resolve;
    });
    let waitForRelease!: Promise<void>;
    const route = lab.createTownPortalReturnLabRoute({
      adapter: async () => {
        adapterCalls += 1;
        waitForRelease = adapterStarted;
        await waitForRelease;
        return {
          kind: "town_portal_lab_display_receipt",
          wrote: true,
          artifact_path: "shared/experiments/town-lab-2026-06-13/happy-path.md",
        };
      },
    });
    const portal = lab.cloneDefaultTownPortal();

    const firstPromise = route.returnToTownPortal({
      portal,
      payload: lab.cloneDefaultTownPortalPayload(),
      currentStateHash: lab.SEMANTIC_HASH,
      turnId: "turn-001",
    });
    await Promise.resolve();
    const secondPromise = route.returnToTownPortal({
      portal,
      payload: lab.cloneDefaultTownPortalPayload(),
      currentStateHash: lab.SEMANTIC_HASH,
      turnId: "turn-001",
    });
    releaseAdapter();

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.status).toBe("accepted");
    expect(second).toMatchObject({
      status: "rejected",
      reason: "portal_already_consumed",
      adapter_called: false,
    });
    expect(adapterCalls).toBe(1);
  });

  test("stress harness covers the abuse matrix and writes a bounded report", async () => {
    const harness = await loadStressHarness();
    const repoRoot = await mkdtemp(join(tmpdir(), "town-portal-stress-"));
    const summary = await harness.runPortalReturnStressHarness({ repoRoot });
    const report = await readFile(
      join(repoRoot, "shared", "experiments", "town-lab-2026-06-13", "portal-stress-harness-report.md"),
      "utf8"
    );

    expect(summary.fail_count).toBe(0);
    expect(summary.pass_count).toBe(summary.case_count);
    expect(summary.case_count).toBeGreaterThanOrEqual(8);
    expect(summary.cases.map((item) => item.id)).toEqual(expect.arrayContaining([
      "TPS-001",
      "TPS-002",
      "TPS-003",
      "TPS-004",
      "TPS-005",
      "TPS-006",
      "TPS-007",
      "TPS-008",
    ]));
    expect(summary.risk_notes.length).toBeGreaterThan(0);
    expect(report).toContain("# Portal Stress Harness Report");
    expect(report).toContain("TPS-007");
  });
});
