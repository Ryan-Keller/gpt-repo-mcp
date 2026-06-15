import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  TownPortalConsumptionStore,
  createTownPortalConsumptionRecord
} from "../src/services/town-portal-consumption-store.js";
import {
  TownPortalReturnService,
  createTownPortalPayloadFixture,
  createTownPortalFixture,
  semanticTownPortalHash,
  type TownPortalDisplayAdapter
} from "../src/services/town-portal-return-service.js";
import { TownPortalReturnInputSchema } from "../src/contracts/town-portal.contract.js";
import { townPortalReturnHandler } from "../src/tools/handlers.js";

describe("production town portal return prerequisites", () => {
  test("durably records terminal handle consumption across store instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "town-portal-production-consumption-"));
    const firstStore = new TownPortalConsumptionStore(root);
    const portalId = "portal-2026-06-14T164500Z-production-test";
    const record = createTownPortalConsumptionRecord({
      portal_id: portalId,
      repo_id: "shared-agent-bridge",
      target_path: "shared/status/town-portal-production/happy-path.md",
      status: "accepted",
      reason: "accepted_once",
      operation: "write_observation",
      payload_kind: "bridge_status_lab_note",
      adapter: "knowledge_display_write_v0",
      state_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      consumed_at: "2026-06-14T16:45:00.000Z"
    });

    const writeResult = await firstStore.recordTerminal(record);
    const secondStore = new TownPortalConsumptionStore(root);

    expect(writeResult).toMatchObject({ written: true });
    await expect(secondStore.has(portalId)).resolves.toBe(true);
    await expect(secondStore.read(portalId)).resolves.toMatchObject({
      kind: "town_portal_consumption_record",
      portal_id: portalId,
      status: "accepted",
      reason: "accepted_once"
    });
  });

  test("refuses a second terminal write for the same portal id", async () => {
    const root = await mkdtemp(join(tmpdir(), "town-portal-production-consumption-"));
    const store = new TownPortalConsumptionStore(root);
    const portalId = "portal-2026-06-14T164501Z-duplicate-test";
    const record = createTownPortalConsumptionRecord({
      portal_id: portalId,
      repo_id: "shared-agent-bridge",
      target_path: "shared/status/town-portal-production/happy-path.md",
      status: "rejected",
      reason: "payload_kind_mismatch",
      operation: "write_observation",
      payload_kind: "bridge_status_lab_note",
      adapter: "knowledge_display_write_v0",
      state_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      consumed_at: "2026-06-14T16:45:01.000Z"
    });

    await store.recordTerminal(record);
    const duplicateResult = await store.recordTerminal({
      ...record,
      status: "accepted",
      reason: "accepted_once"
    });

    expect(duplicateResult).toMatchObject({
      written: false,
      reason: "portal_already_consumed",
      existing: {
        status: "rejected",
        reason: "payload_kind_mismatch"
      }
    });
  });

  test("rejects non-terminal and unsafe consumption records before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "town-portal-production-consumption-"));
    const store = new TownPortalConsumptionStore(root);

    expect(() => store.recordPath("../escape")).toThrow("unsafe town portal id");
    await expect(store.recordTerminal({
      schema_version: 1,
      kind: "town_portal_consumption_record",
      portal_id: "portal-2026-06-14T164502Z-bad-status",
      repo_id: "shared-agent-bridge",
      target_path: "shared/status/town-portal-production/happy-path.md",
      status: "missing_portal" as never,
      reason: "portal was not provided",
      operation: "write_observation",
      payload_kind: "bridge_status_lab_note",
      adapter: "knowledge_display_write_v0",
      state_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      consumed_at: "2026-06-14T16:45:02.000Z"
    })).rejects.toThrow("town portal consumption record must be terminal");
  });

  test("writes a minimal audit record without secret-bearing fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "town-portal-production-consumption-"));
    const store = new TownPortalConsumptionStore(root);
    const portalId = "portal-2026-06-14T164503Z-audit-shape";
    const result = await store.recordTerminal(createTownPortalConsumptionRecord({
      portal_id: portalId,
      repo_id: "shared-agent-bridge",
      target_path: "shared/status/town-portal-production/happy-path.md",
      status: "conflict",
      reason: "source_observation_changed",
      operation: "write_observation",
      payload_kind: "bridge_panel_observation",
      adapter: "knowledge_display_write_v0",
      state_hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      consumed_at: "2026-06-14T16:45:03.000Z"
    }));
    if (!result.written) {
      throw new Error("expected first terminal write");
    }

    const raw = await readFile(result.path, "utf8");
    const parsed = JSON.parse(raw);

    expect(Object.keys(parsed).sort()).toEqual([
      "adapter",
      "consumed_at",
      "kind",
      "operation",
      "payload_kind",
      "portal_id",
      "reason",
      "repo_id",
      "schema_version",
      "state_hash",
      "status",
      "target_path"
    ]);
    expect(raw).not.toMatch(/token|secret|authorization|connector/i);
  });

  test("production-gated return records terminal consumption before adapter handoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "town-portal-production-consumption-"));
    const store = new TownPortalConsumptionStore(root);
    const adapterCalls: string[] = [];
    const service = new TownPortalReturnService({
      productionConsumptionStore: store,
      adapter: ((handoff) => {
        adapterCalls.push(handoff.portal_id);
        return {
          kind: "town_portal_audit_receipt",
          portal_id: handoff.portal_id,
          status: "accepted",
          reason: "accepted_once",
          adapter: "knowledge_display_write_v0",
          artifact_path: handoff.target_path,
          operation: handoff.operation,
          payload_kind: handoff.payload_kind,
          state_hash: handoff.state_hash
        };
      }) satisfies TownPortalDisplayAdapter
    });
    const portalId = "portal-2026-06-14T164504Z-production-service";
    const stateHash = semanticTownPortalHash({ status: "ready" });
    const result = await service.returnToPortal({
      repo_id: "shared-agent-bridge",
      portal: createTownPortalFixture({ portalId, stateHash }),
      payload: createTownPortalPayloadFixture(),
      current_state_hash: stateHash,
      turn_id: "turn-001"
    });

    expect(result).toMatchObject({
      status: "accepted",
      adapter_called: true
    });
    expect(adapterCalls).toEqual([portalId]);
    await expect(store.read(portalId)).resolves.toMatchObject({
      portal_id: portalId,
      status: "accepted",
      reason: "accepted_once",
      target_path: "shared/status/town-portal-lab/happy-path.md"
    });
  });

  test("production-gated return blocks replay from durable store before adapter handoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "town-portal-production-consumption-"));
    const store = new TownPortalConsumptionStore(root);
    const portalId = "portal-2026-06-14T164505Z-production-replay";
    await store.recordTerminal(createTownPortalConsumptionRecord({
      portal_id: portalId,
      repo_id: "shared-agent-bridge",
      target_path: "shared/status/town-portal-lab/happy-path.md",
      status: "accepted",
      reason: "accepted_once",
      operation: "write_observation",
      payload_kind: "bridge_status_lab_note",
      adapter: "knowledge_display_write_v0",
      state_hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      consumed_at: "2026-06-14T16:45:05.000Z"
    }));
    let adapterCalls = 0;
    const service = new TownPortalReturnService({
      productionConsumptionStore: store,
      adapter: () => {
        adapterCalls += 1;
        throw new Error("replayed production handles must not reach the adapter");
      }
    });
    const stateHash = semanticTownPortalHash({ status: "ready" });

    const result = await service.returnToPortal({
      repo_id: "shared-agent-bridge",
      portal: createTownPortalFixture({ portalId, stateHash }),
      payload: createTownPortalPayloadFixture(),
      current_state_hash: stateHash,
      turn_id: "turn-001"
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "portal_already_consumed",
      adapter_called: false
    });
    expect(adapterCalls).toBe(0);
  });

  test("lab-style return remains in-memory when no production store is supplied", async () => {
    const portalId = "portal-2026-06-14T164506Z-lab-still-in-memory";
    const stateHash = semanticTownPortalHash({ status: "ready" });
    const calls: string[] = [];
    const service = new TownPortalReturnService({
      adapter: ((handoff) => {
        calls.push(handoff.portal_id);
        return {
          kind: "town_portal_audit_receipt",
          portal_id: handoff.portal_id,
          status: "accepted",
          reason: "accepted_once",
          adapter: "knowledge_display_write_v0",
          artifact_path: handoff.target_path,
          operation: handoff.operation,
          payload_kind: handoff.payload_kind,
          state_hash: handoff.state_hash
        };
      }) satisfies TownPortalDisplayAdapter
    });

    const first = await service.returnToPortal({
      repo_id: "shared-agent-bridge",
      portal: createTownPortalFixture({ portalId, stateHash }),
      payload: createTownPortalPayloadFixture(),
      current_state_hash: stateHash,
      turn_id: "turn-001"
    });
    const second = await service.returnToPortal({
      repo_id: "shared-agent-bridge",
      portal: createTownPortalFixture({ portalId, stateHash }),
      payload: createTownPortalPayloadFixture(),
      current_state_hash: stateHash,
      turn_id: "turn-001"
    });

    expect(first.status).toBe("accepted");
    expect(second).toMatchObject({
      status: "rejected",
      reason: "portal_already_consumed",
      adapter_called: false
    });
    expect(calls).toEqual([portalId]);
  });

  test("contract accepts either lab advisory mode or source-level production mode", () => {
    const stateHash = semanticTownPortalHash({ status: "ready" });
    const base = {
      repo_id: "shared-agent-bridge",
      portal: createTownPortalFixture({ stateHash }),
      payload: createTownPortalPayloadFixture(),
      current_state_hash: stateHash,
      turn_id: "turn-001"
    };

    expect(TownPortalReturnInputSchema.parse({
      ...base,
      lab_mode: "town_portal_advisory_v0"
    })).toMatchObject({ lab_mode: "town_portal_advisory_v0" });
    expect(TownPortalReturnInputSchema.parse({
      ...base,
      production_mode: "town_portal_production_v0"
    })).toMatchObject({ production_mode: "town_portal_production_v0" });
    expect(TownPortalReturnInputSchema.parse({
      ...base,
      lab_mode: "town_portal_advisory_v0",
      production_mode: "town_portal_production_v0"
    })).toMatchObject({
      lab_mode: "town_portal_advisory_v0",
      production_mode: "town_portal_production_v0"
    });
  });

  test("handler production mode uses durable store and blocks replay", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "town-portal-production-handler-"));
    const context = testRuntimeContext(repoRoot);
    const portalId = "portal-2026-06-14T164507Z-handler-production";
    const stateHash = semanticTownPortalHash({ status: "ready" });
    const input = {
      repo_id: "shared-agent-bridge",
      production_mode: "town_portal_production_v0",
      portal: createTownPortalFixture({ portalId, stateHash }),
      payload: createTownPortalPayloadFixture(),
      current_state_hash: stateHash,
      turn_id: "turn-001"
    };

    const first = await townPortalReturnHandler(input, context);
    const second = await townPortalReturnHandler(input, context);
    const durableRecord = JSON.parse(await readFile(
      join(repoRoot, "shared", "portals", "production-consumptions", `${portalId}.json`),
      "utf8"
    ));

    expect(first.structuredContent).toMatchObject({
      status: "accepted",
      adapter_called: true
    });
    expect(second.structuredContent).toMatchObject({
      status: "rejected",
      reason: "portal_already_consumed",
      adapter_called: false
    });
    expect(durableRecord).toMatchObject({
      portal_id: portalId,
      status: "accepted",
      reason: "accepted_once"
    });
  });

  test("handler rejects missing or ambiguous town portal modes", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "town-portal-production-handler-"));
    const context = testRuntimeContext(repoRoot);
    const stateHash = semanticTownPortalHash({ status: "ready" });
    const base = {
      repo_id: "shared-agent-bridge",
      portal: createTownPortalFixture({ stateHash }),
      payload: createTownPortalPayloadFixture(),
      current_state_hash: stateHash,
      turn_id: "turn-001"
    };

    const missingMode = await townPortalReturnHandler(base, context);
    const bothModes = await townPortalReturnHandler({
      ...base,
      lab_mode: "town_portal_advisory_v0",
      production_mode: "town_portal_production_v0"
    }, context);

    expect(missingMode.isError).toBe(true);
    expect(bothModes.isError).toBe(true);
  });
});

function testRuntimeContext(repoRoot: string) {
  return {
    registry: {
      get(repoId: string) {
        if (repoId !== "shared-agent-bridge") {
          throw new Error(`unexpected repo id ${repoId}`);
        }
        return {
          repo_id: "shared-agent-bridge",
          root: repoRoot,
          writes: {},
          operations: {}
        };
      }
    },
    diagnostics: {
      recordSuccess() {},
      recordToolError() {}
    }
  } as never;
}
