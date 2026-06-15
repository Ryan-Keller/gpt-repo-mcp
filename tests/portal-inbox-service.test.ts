import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { PortalInboxService } from "../src/services/portal-inbox-service.js";

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map(async (root) => {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  }));
});

describe("portal inbox service", () => {
  test("groups tiny inbox cards and hydrates one selected portal with receipt metadata", async () => {
    const root = await createPortalFixtureRepo();
    const service = new PortalInboxService(root);

    const result = await service.read({
      portal_id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d"
    });

    expect(result).toMatchObject({
      ok: true,
      surface: "read_only_portal_inbox_v0",
      counts: {
        total_portals: 3,
        status_groups: 3,
        selected_receipt_count: 1
      },
      status_groups: [
        {
          status: "active",
          count: 1,
          cards: [
            expect.objectContaining({
              portal_id: "portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee",
              summary: "Active portal still allows one bounded verification return."
            })
          ]
        },
        {
          status: "returned",
          count: 1,
          cards: [
            expect.objectContaining({
              portal_id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
              next_requested_decision: "accept_or_park"
            })
          ]
        },
        {
          status: "consumed",
          count: 1
        }
      ],
      selection: {
        portal_id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
        found: true
      },
      selected_portal: {
        id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
        status: "returned",
        latest_receipt_path: "shared/portals/receipts/portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d/2026-06-13T16-42-00.000Z-returned.json"
      },
      receipts: [
        expect.objectContaining({
          receipt_path: "shared/portals/receipts/portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d/2026-06-13T16-42-00.000Z-returned.json",
          to_status: "returned",
          summary: "Fresh chat returned a bounded recovery card and is waiting for accept or park."
        })
      ],
      warnings: []
    });
  });

  test("returns a focused not-found selection without mutating the inbox view", async () => {
    const root = await createPortalFixtureRepo();
    const service = new PortalInboxService(root);

    const result = await service.read({
      portal_id: "portal-missing"
    });

    expect(result.status_groups).toHaveLength(3);
    expect(result.selection).toEqual({
      portal_id: "portal-missing",
      found: false
    });
    expect(result.selected_portal).toBeNull();
    expect(result.receipts).toEqual([]);
    expect(result.warnings).toContain("PORTAL_ID_NOT_FOUND");
  });
});

async function createPortalFixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "portal-inbox-service-"));
  createdRoots.push(root);
  await mkdir(join(root, "shared", "portals", "objects"), { recursive: true });
  await mkdir(join(root, "shared", "portals", "receipts", "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d"), { recursive: true });
  await mkdir(join(root, "shared", "portals", "receipts", "portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee"), { recursive: true });
  await mkdir(join(root, "shared", "portals", "receipts", "portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e"), { recursive: true });

  await writeFile(join(root, "shared", "portals", "inbox.md"), `# Portal Inbox

| Portal ID | Status | Archetype | Lane | Opened At | Expires At | Summary | Object | Latest Receipt | Next Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| \`portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee\` | \`active\` | \`verifier\` | \`knowledge\` | \`2026-06-13T16:45:00.000Z\` | \`2026-06-13T17:15:00.000Z\` | Active portal still allows one bounded verification return. | \`shared/portals/objects/portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee.json\` | \`shared/portals/receipts/portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee/2026-06-13T16-45-00.000Z-opened.json\` | \`continue_or_refresh\` |
| \`portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d\` | \`returned\` | \`scout\` | \`knowledge\` | \`2026-06-13T16:35:21.582Z\` | \`2026-06-13T17:05:21.582Z\` | Fresh chat recovered the portal and proposed a bounded status note. | \`shared/portals/objects/portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d.json\` | \`shared/portals/receipts/portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d/2026-06-13T16-42-00.000Z-returned.json\` | \`accept_or_park\` |
| \`portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e\` | \`consumed\` | \`builder\` | \`knowledge\` | \`2026-06-13T15:05:00.000Z\` | \`2026-06-13T15:35:00.000Z\` | Accepted once and compacted into durable consumed history. | \`shared/portals/objects/portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e.json\` | \`shared/portals/receipts/portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e/2026-06-13T15-14-00.000Z-consumed.json\` | \`history_only\` |
`, "utf8");

  await writeFile(join(root, "shared", "portals", "objects", "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d.json"), `${JSON.stringify({
    schema_version: 1,
    id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
    type: "town_portal",
    archetype: "scout",
    lane: "knowledge",
    opened_at: "2026-06-13T16:35:21.582Z",
    expires_at: "2026-06-13T17:05:21.582Z",
    allowed_paths: ["shared/status/**", "shared/portals/**"],
    allowed_operation: "write_observation",
    observed_state_hash: "sha256:sample-scout-status-lab-semantic-hash",
    target_return_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md",
    status: "returned",
    return_card: {
      kind: "portal_return_card_scout_v0",
      summary: "Fresh chat recovered the portal and proposed a bounded status note.",
      artifact_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md",
      evidence_links: ["shared/protocols/TOWN_PORTAL_PRODUCTION_CONTRACT_V0.md"],
      next_requested_decision: "accept_or_park",
      observed_state_hash: "sha256:sample-scout-status-lab-semantic-hash",
      target_return_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md"
    },
    evidence_links: ["shared/protocols/TOWN_PORTAL_PRIMITIVE_V0.md"],
    consumed_at: null,
    consumed_by: null,
    session_metadata: {
      opened_by_chat: "sample-chat-a",
      opened_by_tool: "repo_bridge_concierge",
      returned_by_chat: "sample-chat-b"
    },
    next_requested_decision: "accept_or_park",
    revision: 3,
    latest_receipt_path: "shared/portals/receipts/portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d/2026-06-13T16-42-00.000Z-returned.json"
  }, null, 2)}\n`, "utf8");

  await writeFile(join(root, "shared", "portals", "objects", "portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee.json"), `${JSON.stringify({
    schema_version: 1,
    id: "portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee",
    type: "town_portal",
    archetype: "verifier",
    lane: "knowledge",
    opened_at: "2026-06-13T16:45:00.000Z",
    expires_at: "2026-06-13T17:15:00.000Z",
    allowed_paths: ["shared/status/**", "shared/portals/**"],
    allowed_operation: "write_observation",
    observed_state_hash: "sha256:sample-verifier-queue-check-semantic-hash",
    target_return_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md",
    status: "active",
    return_card: {
      kind: "portal_return_card_verifier_v0",
      summary: "Active portal still allows one bounded verification return.",
      artifact_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md",
      evidence_links: ["shared/status/2026-06-13-lab-exec-live-check.md"],
      next_requested_decision: "continue_or_refresh",
      observed_state_hash: "sha256:sample-verifier-queue-check-semantic-hash",
      target_return_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md"
    },
    evidence_links: ["shared/status/2026-06-13-lab-exec-live-check.md"],
    consumed_at: null,
    consumed_by: null,
    session_metadata: {
      opened_by_chat: "sample-chat-d",
      opened_by_tool: "repo_runner_status"
    },
    next_requested_decision: "continue_or_refresh",
    revision: 1,
    latest_receipt_path: "shared/portals/receipts/portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee/2026-06-13T16-45-00.000Z-opened.json"
  }, null, 2)}\n`, "utf8");

  await writeFile(join(root, "shared", "portals", "objects", "portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e.json"), `${JSON.stringify({
    schema_version: 1,
    id: "portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e",
    type: "town_portal",
    archetype: "builder",
    lane: "knowledge",
    opened_at: "2026-06-13T15:05:00.000Z",
    expires_at: "2026-06-13T15:35:00.000Z",
    allowed_paths: ["shared/status/**"],
    allowed_operation: "write_observation",
    observed_state_hash: "sha256:sample-builder-proof-semantic-hash",
    target_return_path: "shared/status/2026-06-13-lab-portal-return-route.md",
    status: "consumed",
    return_card: {
      kind: "portal_return_card_builder_v0",
      summary: "Accepted once and compacted into durable consumed history.",
      artifact_path: "shared/status/2026-06-13-lab-portal-return-route.md",
      evidence_links: ["shared/experiments/town-lab-2026-06-13/portal-return-lab-route-run.md"],
      next_requested_decision: "history_only",
      observed_state_hash: "sha256:sample-builder-proof-semantic-hash",
      target_return_path: "shared/status/2026-06-13-lab-portal-return-route.md"
    },
    evidence_links: ["shared/status/2026-06-13-lab-portal-return-route.md"],
    consumed_at: "2026-06-13T15:14:00.000Z",
    consumed_by: {
      chat_id: "sample-chat-c",
      tool: "portal_inbox_reader_v0"
    },
    session_metadata: {
      opened_by_chat: "sample-chat-c",
      returned_by_chat: "sample-chat-c"
    },
    next_requested_decision: "history_only",
    revision: 4,
    latest_receipt_path: "shared/portals/receipts/portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e/2026-06-13T15-14-00.000Z-consumed.json"
  }, null, 2)}\n`, "utf8");

  await writeFile(join(root, "shared", "portals", "receipts", "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d", "2026-06-13T16-42-00.000Z-returned.json"), `${JSON.stringify({
    receipt_type: "portal_transition",
    portal_id: "portal-2026-06-13T163521Z-scout-status-lab-b8b95f4d",
    from_status: "active",
    to_status: "returned",
    recorded_at: "2026-06-13T16:42:00.000Z",
    recorded_by: {
      chat_id: "sample-chat-b",
      tool: "repo_bridge_concierge"
    },
    expected_revision: 2,
    new_revision: 3,
    observed_state_hash: "sha256:sample-scout-status-lab-semantic-hash",
    target_return_path: "shared/status/2026-06-13-cross-chat-portal-registry-v0.md",
    next_requested_decision: "accept_or_park",
    summary: "Fresh chat returned a bounded recovery card and is waiting for accept or park."
  }, null, 2)}\n`, "utf8");

  await writeFile(join(root, "shared", "portals", "receipts", "portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee", "2026-06-13T16-45-00.000Z-opened.json"), `${JSON.stringify({
    receipt_type: "portal_transition",
    portal_id: "portal-2026-06-13T164500Z-verifier-queue-check-sample-91a7d0ee",
    from_status: "open",
    to_status: "active",
    recorded_at: "2026-06-13T16:45:00.000Z",
    summary: "Portal opened for one bounded verification lane."
  }, null, 2)}\n`, "utf8");

  await writeFile(join(root, "shared", "portals", "receipts", "portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e", "2026-06-13T15-14-00.000Z-consumed.json"), `${JSON.stringify({
    receipt_type: "portal_transition",
    portal_id: "portal-2026-06-13T150500Z-builder-proof-sample-4f1a0c2e",
    from_status: "accepted",
    to_status: "consumed",
    recorded_at: "2026-06-13T15:14:00.000Z",
    summary: "Portal consumed after accepted build proof."
  }, null, 2)}\n`, "utf8");

  return root;
}
