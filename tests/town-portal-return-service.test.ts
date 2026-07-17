import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  TownPortalReturnService,
  createTownPortalPayloadFixture,
  createTownPortalFixture,
  semanticTownPortalHash,
  type TownPortalDisplayAdapter,
  type TownPortalPayload,
  type TownPortalRecord
} from "../src/services/town-portal-return-service.js";

describe("TownPortalReturnService", () => {
  test("accepts a matching display-only return and calls the adapter once", async () => {
    const calls: Array<{ target_path: string; body: string }> = [];
    const service = new TownPortalReturnService({
      adapter: ((handoff) => {
        calls.push({ target_path: handoff.target_path, body: handoff.body });
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
    const observedState = {
      repo_id: "shared-agent-bridge",
      target_path: "shared/status/town-portal-lab/happy-path.md",
      source_tool: "repo_bridge_concierge",
      panel_state: { status: "ready" }
    };
    const stateHash = semanticTownPortalHash(observedState);
    const portal = createTownPortalFixture({ stateHash });
    const payload = createTownPortalPayloadFixture();

    const result = await service.returnToPortal({
      repo_id: "shared-agent-bridge",
      portal,
      payload,
      current_state_hash: stateHash,
      turn_id: "turn-001"
    });

    expect(result).toMatchObject({
      kind: "town_portal_return_result",
      status: "accepted",
      reason: "accepted_once",
      terminal: true,
      consume_handle: true,
      adapter_called: true,
      handoff: {
        repo_id: "shared-agent-bridge",
        target_path: "shared/status/town-portal-lab/happy-path.md",
        operation: "write_observation",
        payload_kind: "bridge_status_lab_note"
      }
    });
    expect(calls).toEqual([{
      target_path: "shared/status/town-portal-lab/happy-path.md",
      body: "Town Portal lab note."
    }]);
  });

  test.each([
    ["wrong kind", (portal: TownPortalRecord, payload: TownPortalPayload) => { void payload; portal.kind = "memory_portal"; }, "rejected", "portal_kind_mismatch"],
    ["wrong schema", (portal: TownPortalRecord, payload: TownPortalPayload) => { void payload; portal.schema_version = 2; }, "rejected", "unsupported_schema_version"],
    ["repo mismatch", (portal: TownPortalRecord, payload: TownPortalPayload) => { void portal; payload.repo_id = "other"; }, "rejected", "repo_id_mismatch"],
    ["path mismatch", (portal: TownPortalRecord, payload: TownPortalPayload) => { void portal; payload.target_path = "shared/status/town-portal-lab/other.md"; }, "rejected", "target_path_mismatch"],
    ["operation mismatch", (portal: TownPortalRecord, payload: TownPortalPayload) => { void portal; payload.operation = "launch_agent"; }, "rejected", "operation_mismatch"],
    ["payload kind mismatch", (portal: TownPortalRecord, payload: TownPortalPayload) => { void portal; payload.kind = "arbitrary_note"; }, "rejected", "payload_kind_mismatch"],
    ["display violation", (portal: TownPortalRecord, payload: TownPortalPayload) => { void portal; payload.display_only = false; }, "rejected", "display_only_required"],
    ["single-use violation", (portal: TownPortalRecord, payload: TownPortalPayload) => { void payload; portal.return_contract!.single_use = false; }, "rejected", "single_use_required"],
    ["follow-up violation", (portal: TownPortalRecord, payload: TownPortalPayload) => { void payload; portal.constraints!.no_followup_activity = false; }, "rejected", "no_followup_activity_required"],
    ["approval missing", (portal: TownPortalRecord, payload: TownPortalPayload) => { void payload; portal.constraints!.requires_approval = true; }, "rejected", "approval_required"]
  ])("rejects %s before adapter handoff", async (_name, mutate, expectedStatus, expectedReason) => {
    let adapterCalls = 0;
    const service = new TownPortalReturnService({
      adapter: () => {
        adapterCalls += 1;
        throw new Error("rejected returns must not reach the adapter");
      }
    });
    const stateHash = semanticTownPortalHash({ status: "ready" });
    const portal = createTownPortalFixture({ stateHash });
    const payload = createTownPortalPayloadFixture();
    mutate(portal, payload);

    const result = await service.returnToPortal({
      repo_id: "shared-agent-bridge",
      portal,
      payload,
      current_state_hash: stateHash,
      turn_id: "turn-001"
    });

    expect(result).toMatchObject({
      status: expectedStatus,
      reason: expectedReason,
      adapter_called: false,
      consume_handle: true
    });
    expect(adapterCalls).toBe(0);
  });

  test("returns missing_portal without consuming a handle", async () => {
    const service = new TownPortalReturnService({
      adapter: () => {
        throw new Error("missing portal must not reach the adapter");
      }
    });

    const result = await service.returnToPortal({
      repo_id: "shared-agent-bridge",
      portal: null,
      payload: createTownPortalPayloadFixture(),
      current_state_hash: semanticTownPortalHash({ status: "ready" }),
      turn_id: "turn-001"
    });

    expect(result).toMatchObject({
      status: "missing_portal",
      consume_handle: false,
      adapter_called: false
    });
  });

  test("consumes accepted, rejected, expired, and conflict outcomes", async () => {
    const service = new TownPortalReturnService({
      adapter: () => ({
        kind: "town_portal_audit_receipt",
        portal_id: "portal",
        status: "accepted",
        reason: "accepted_once",
        adapter: "knowledge_display_write_v0",
        artifact_path: "shared/status/town-portal-lab/happy-path.md",
        operation: "write_observation",
        payload_kind: "bridge_status_lab_note",
        state_hash: semanticTownPortalHash({ status: "ready" })
      })
    });
    const stateHash = semanticTownPortalHash({ status: "ready" });

    const acceptedPortal = createTownPortalFixture({ portalId: "accepted", stateHash });
    expect((await service.returnToPortal({
      repo_id: "shared-agent-bridge",
      portal: acceptedPortal,
      payload: createTownPortalPayloadFixture(),
      current_state_hash: stateHash,
      turn_id: "turn-001"
    })).status).toBe("accepted");
    expect((await service.returnToPortal({
      repo_id: "shared-agent-bridge",
      portal: acceptedPortal,
      payload: createTownPortalPayloadFixture(),
      current_state_hash: stateHash,
      turn_id: "turn-001"
    })).reason).toBe("portal_already_consumed");

    for (const [portalId, mutate, expected] of [
      ["rejected", (portal: TownPortalRecord) => { portal.kind = "bad"; }, "rejected"],
      ["expired", (portal: TownPortalRecord) => { portal.expires_turn_id = "turn-000"; }, "expired"],
      ["conflict", (portal: TownPortalRecord) => { void portal; }, "conflict"]
    ] as const) {
      const portal = createTownPortalFixture({ portalId, stateHash });
      mutate(portal);
      const first = await service.returnToPortal({
        repo_id: "shared-agent-bridge",
        portal,
        payload: createTownPortalPayloadFixture(),
        current_state_hash: expected === "conflict" ? semanticTownPortalHash({ status: "changed" }) : stateHash,
        turn_id: "turn-001"
      });
      const second = await service.returnToPortal({
        repo_id: "shared-agent-bridge",
        portal,
        payload: createTownPortalPayloadFixture(),
        current_state_hash: stateHash,
        turn_id: "turn-001"
      });
      expect(first.status).toBe(expected);
      expect(second.reason).toBe("portal_already_consumed");
      expect(second.adapter_called).toBe(false);
    }
  });

  test.each([
    ["absolute path", "/tmp/out.md"],
    ["backslash path", "shared\\status\\town-portal-lab\\out.md"],
    ["drive path", "C:/tmp/out.md"],
    ["dot segment", "shared/status/./out.md"],
    ["traversal", "shared/status/../out.md"],
    ["wrong root", "shared/tasks/out.md"]
  ])("adapter gate rejects %s", async (_name, targetPath) => {
    const root = await mkdtemp(join(tmpdir(), "town-portal-adapter-"));
    const service = TownPortalReturnService.withKnowledgeDisplayAdapter({ repoRoot: root });
    const stateHash = semanticTownPortalHash({ status: "ready" });
    const portal = createTownPortalFixture({ stateHash, targetPath });
    const payload = createTownPortalPayloadFixture({ targetPath });

    const result = await service.returnToPortal({
      repo_id: "shared-agent-bridge",
      portal,
      payload,
      current_state_hash: stateHash,
      turn_id: "turn-001"
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "adapter_gate_rejected",
      adapter_called: false
    });
  });

  test("knowledge display adapter writes one inert status artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "town-portal-adapter-"));
    await writeRepoFile(root, "shared/status/town-portal-lab/.keep", "");
    const service = TownPortalReturnService.withKnowledgeDisplayAdapter({ repoRoot: root });
    const stateHash = semanticTownPortalHash({ status: "ready" });

    const result = await service.returnToPortal({
      repo_id: "shared-agent-bridge",
      portal: createTownPortalFixture({ stateHash }),
      payload: createTownPortalPayloadFixture(),
      current_state_hash: stateHash,
      turn_id: "turn-001"
    });
    const content = await readFile(join(root, "shared", "status", "town-portal-lab", "happy-path.md"), "utf8");

    expect(result).toMatchObject({
      status: "accepted",
      adapter_called: true,
      audit_receipt: {
        adapter: "knowledge_display_write_v0",
        artifact_path: "shared/status/town-portal-lab/happy-path.md"
      }
    });
    expect(content).toContain("status: accepted");
    expect(content).toContain("Town Portal lab note.");
  });
});

async function writeRepoFile(root: string, repoPath: string, content: string): Promise<void> {
  const absolutePath = join(root, ...repoPath.split("/"));
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}
