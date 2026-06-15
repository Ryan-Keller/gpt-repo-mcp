import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  TownPortalConsumptionStore,
  createTownPortalConsumptionRecord
} from "./town-portal-consumption-store.js";

const SUPPORTED_SCHEMA_VERSION = 1;
const APPROVED_REPO_ID = "shared-agent-bridge";
const APPROVED_STATUS_ROOT = "shared/status/town-portal-lab";
const ALLOWED_OPERATION = "write_observation";
const ALLOWED_PAYLOAD_KINDS = new Set(["bridge_status_lab_note", "bridge_panel_observation"]);
const ADAPTER_NAME = "knowledge_display_write_v0";

export type TownPortalDisplayAdapterHandoff = {
  portal_id: string;
  repo_id: string;
  target_path: string;
  operation: string;
  payload_kind: string;
  state_hash: string;
  body: string;
};

export type TownPortalAuditReceipt = {
  kind: "town_portal_audit_receipt";
  portal_id: string;
  status: "accepted";
  reason: "accepted_once";
  adapter: "knowledge_display_write_v0";
  artifact_path: string;
  operation: string;
  payload_kind: string;
  state_hash: string;
};

export type TownPortalDisplayAdapter = (
  handoff: TownPortalDisplayAdapterHandoff
) => TownPortalAuditReceipt | Promise<TownPortalAuditReceipt>;

export type TownPortalReturnStatus = "accepted" | "rejected" | "expired" | "conflict" | "missing_portal";

export type TownPortalReturnResult = {
  kind: "town_portal_return_result";
  status: TownPortalReturnStatus;
  reason: string;
  terminal: true;
  consume_handle: boolean;
  adapter_called: boolean;
  handoff?: {
    repo_id: string;
    target_path: string;
    operation: string;
    payload_kind: string;
  };
  audit_receipt?: TownPortalAuditReceipt;
  conflict?: {
    kind: "town_portal_conflict";
    portal_id: string;
    old_state_hash: string;
    current_state_hash: string;
    next: "refresh_state";
  };
};

type TownPortalReturnInput = {
  repo_id: string;
  portal: Record<string, any> | null | undefined;
  payload: Record<string, any>;
  current_state_hash: string;
  turn_id: string;
  approval_present?: boolean;
};

type ServiceOptions = {
  adapter: TownPortalDisplayAdapter;
  consumedPortalIds?: Set<string>;
  productionConsumptionStore?: TownPortalConsumptionStore;
};

type Decision = Omit<TownPortalReturnResult, "adapter_called" | "audit_receipt"> & {
  adapterHandoff?: TownPortalDisplayAdapterHandoff;
};

export class TownPortalReturnService {
  private readonly adapter: TownPortalDisplayAdapter;
  private readonly consumedPortalIds: Set<string>;
  private readonly productionConsumptionStore?: TownPortalConsumptionStore;

  constructor(options: ServiceOptions) {
    this.adapter = options.adapter;
    this.consumedPortalIds = options.consumedPortalIds ?? new Set();
    this.productionConsumptionStore = options.productionConsumptionStore;
  }

  static withKnowledgeDisplayAdapter({
    repoRoot,
    consumedPortalIds,
    productionConsumptionStore
  }: {
    repoRoot: string;
    consumedPortalIds?: Set<string>;
    productionConsumptionStore?: TownPortalConsumptionStore;
  }): TownPortalReturnService {
    return new TownPortalReturnService({
      adapter: createKnowledgeDisplayAdapter({ repoRoot }),
      consumedPortalIds,
      productionConsumptionStore
    });
  }

  async returnToPortal(input: TownPortalReturnInput): Promise<TownPortalReturnResult> {
    const portalId = typeof input.portal?.portal_id === "string" ? input.portal.portal_id : "";
    if (portalId && await this.productionConsumptionStore?.has(portalId)) {
      return {
        ...terminal("rejected", "portal_already_consumed", true),
        adapter_called: false
      };
    }

    const decision = validateTownPortalReturn(input, this.consumedPortalIds);
    if (decision.consume_handle && portalId) {
      this.consumedPortalIds.add(portalId);
      if (this.productionConsumptionStore && decision.status !== "missing_portal") {
        const consumption = await this.productionConsumptionStore.recordTerminal(toConsumptionRecord(input, decision, portalId));
        if (!consumption.written) {
          return {
            ...terminal("rejected", "portal_already_consumed", true),
            adapter_called: false
          };
        }
      }
    }
    if (decision.status !== "accepted" || !decision.adapterHandoff) {
      return {
        ...withoutAdapterHandoff(decision),
        adapter_called: false
      };
    }

    const receipt = await this.adapter(decision.adapterHandoff);
    return {
      ...withoutAdapterHandoff(decision),
      adapter_called: true,
      audit_receipt: receipt
    };
  }
}

function toConsumptionRecord(
  input: TownPortalReturnInput,
  decision: Decision,
  portalId: string
) {
  if (decision.status === "missing_portal") {
    throw new Error("missing portal is not a consumable terminal record");
  }
  return createTownPortalConsumptionRecord({
    portal_id: portalId,
    repo_id: APPROVED_REPO_ID,
    target_path: String(decision.handoff?.target_path ?? input.portal?.location?.target_path ?? input.payload?.target_path ?? ""),
    status: decision.status,
    reason: decision.reason,
    operation: String(decision.handoff?.operation ?? input.payload?.operation ?? input.portal?.return_contract?.allowed_operation ?? ""),
    payload_kind: String(decision.handoff?.payload_kind ?? input.payload?.kind ?? input.portal?.return_contract?.allowed_payload_kind ?? ""),
    adapter: ADAPTER_NAME,
    state_hash: String(input.portal?.location?.state_hash ?? input.current_state_hash)
  });
}

export function semanticTownPortalHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function createTownPortalFixture({
  portalId = "town-portal-test-001",
  targetPath = "shared/status/town-portal-lab/happy-path.md",
  stateHash = semanticTownPortalHash({ status: "ready" })
}: {
  portalId?: string;
  targetPath?: string;
  stateHash?: string;
} = {}): Record<string, any> {
  return {
    kind: "town_portal",
    schema_version: 1,
    portal_id: portalId,
    status: "open",
    opened_by: {
      tool: "repo_bridge_concierge",
      request: "test portal",
      observed_at: "2026-06-13T00:00:00.000Z"
    },
    opened_turn_id: "turn-001",
    expires_turn_id: "turn-001",
    location: {
      repo_id: APPROVED_REPO_ID,
      target_path: targetPath,
      state_hash: stateHash
    },
    return_contract: {
      allowed_operation: ALLOWED_OPERATION,
      allowed_payload_kind: "bridge_status_lab_note",
      single_use: true,
      expires_after: "this_chat_turn"
    },
    constraints: {
      single_path_only: true,
      display_only: true,
      requires_approval: false,
      no_followup_activity: true
    }
  };
}

export function createTownPortalPayloadFixture({
  targetPath = "shared/status/town-portal-lab/happy-path.md"
}: {
  targetPath?: string;
} = {}): Record<string, any> {
  return {
    kind: "bridge_status_lab_note",
    schema_version: 1,
    operation: ALLOWED_OPERATION,
    repo_id: APPROVED_REPO_ID,
    target_path: targetPath,
    display_only: true,
    body: "Town Portal lab note."
  };
}

function validateTownPortalReturn(input: TownPortalReturnInput, consumedPortalIds: Set<string>): Decision {
  const portal = input.portal;
  if (!portal) {
    return terminal("missing_portal", "portal was not provided", false);
  }

  const portalId = typeof portal.portal_id === "string" ? portal.portal_id : "";
  if (!portalId || consumedPortalIds.has(portalId)) {
    return terminal("rejected", "portal_already_consumed", true);
  }
  if (portal.status !== "open") {
    return terminal("rejected", "portal_not_open", true);
  }
  if (portal.kind !== "town_portal") {
    return terminal("rejected", "portal_kind_mismatch", true);
  }
  if (portal.schema_version !== SUPPORTED_SCHEMA_VERSION || input.payload?.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    return terminal("rejected", "unsupported_schema_version", true);
  }
  if (portal.location?.repo_id !== APPROVED_REPO_ID || input.payload?.repo_id !== APPROVED_REPO_ID || input.repo_id !== APPROVED_REPO_ID) {
    return terminal("rejected", "repo_id_mismatch", true);
  }
  if (portal.location?.target_path !== input.payload?.target_path) {
    return terminal("rejected", "target_path_mismatch", true);
  }
  if (portal.return_contract?.allowed_operation !== input.payload?.operation || input.payload?.operation !== ALLOWED_OPERATION) {
    return terminal("rejected", "operation_mismatch", true);
  }
  if (portal.return_contract?.allowed_payload_kind !== input.payload?.kind || !ALLOWED_PAYLOAD_KINDS.has(String(input.payload?.kind))) {
    return terminal("rejected", "payload_kind_mismatch", true);
  }
  if (portal.constraints?.single_path_only !== true) {
    return terminal("rejected", "single_path_only_required", true);
  }
  if (portal.constraints?.display_only !== true || input.payload?.display_only !== true) {
    return terminal("rejected", "display_only_required", true);
  }
  if (portal.constraints?.no_followup_activity !== true) {
    return terminal("rejected", "no_followup_activity_required", true);
  }
  if (portal.return_contract?.single_use !== true) {
    return terminal("rejected", "single_use_required", true);
  }
  if (portal.constraints?.requires_approval === true && input.approval_present !== true) {
    return terminal("rejected", "approval_required", true);
  }
  if (portal.return_contract?.expires_after !== "this_chat_turn" || portal.expires_turn_id !== input.turn_id) {
    return terminal("expired", "portal_expired", true);
  }
  const oldStateHash = String(portal.location?.state_hash ?? "");
  if (oldStateHash !== input.current_state_hash) {
    return {
      ...terminal("conflict", "source_observation_changed", true),
      conflict: {
        kind: "town_portal_conflict",
        portal_id: portalId,
        old_state_hash: oldStateHash,
        current_state_hash: input.current_state_hash,
        next: "refresh_state"
      }
    };
  }
  if (!adapterAllows(input.payload.target_path, input.payload.operation, input.payload.kind)) {
    return terminal("rejected", "adapter_gate_rejected", true);
  }

  return {
    ...terminal("accepted", "accepted_once", true),
    handoff: {
      repo_id: APPROVED_REPO_ID,
      target_path: input.payload.target_path,
      operation: input.payload.operation,
      payload_kind: input.payload.kind
    },
    adapterHandoff: {
      portal_id: portalId,
      repo_id: APPROVED_REPO_ID,
      target_path: input.payload.target_path,
      operation: input.payload.operation,
      payload_kind: input.payload.kind,
      state_hash: oldStateHash,
      body: String(input.payload.body ?? "")
    }
  };
}

function createKnowledgeDisplayAdapter({ repoRoot }: { repoRoot: string }): TownPortalDisplayAdapter {
  return async (handoff) => {
    if (!adapterAllows(handoff.target_path, handoff.operation, handoff.payload_kind)) {
      throw new Error("knowledge display adapter refused unsafe handoff");
    }
    const absolutePath = resolve(repoRoot, ...handoff.target_path.split("/"));
    const allowedRoot = resolve(repoRoot, ...APPROVED_STATUS_ROOT.split("/"));
    if (!absolutePath.startsWith(allowedRoot + sep)) {
      throw new Error("knowledge display adapter refused path outside approved root");
    }

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, renderDisplayArtifact(handoff), "utf8");
    return {
      kind: "town_portal_audit_receipt",
      portal_id: handoff.portal_id,
      status: "accepted",
      reason: "accepted_once",
      adapter: ADAPTER_NAME,
      artifact_path: handoff.target_path,
      operation: handoff.operation,
      payload_kind: handoff.payload_kind,
      state_hash: handoff.state_hash
    };
  };
}

function adapterAllows(targetPath: unknown, operation: unknown, payloadKind: unknown): boolean {
  if (operation !== ALLOWED_OPERATION || !ALLOWED_PAYLOAD_KINDS.has(String(payloadKind))) {
    return false;
  }
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    return false;
  }
  if (targetPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(targetPath) || targetPath.includes("\\")) {
    return false;
  }
  const parts = targetPath.split("/");
  if (parts.includes(".") || parts.includes("..")) {
    return false;
  }
  return targetPath.startsWith(`${APPROVED_STATUS_ROOT}/`) && targetPath.endsWith(".md");
}

function terminal(status: TownPortalReturnStatus, reason: string, consumeHandle: boolean): Decision {
  return {
    kind: "town_portal_return_result",
    status,
    reason,
    terminal: true,
    consume_handle: consumeHandle
  };
}

function withoutAdapterHandoff(decision: Decision): Omit<TownPortalReturnResult, "adapter_called" | "audit_receipt"> {
  const { adapterHandoff: _adapterHandoff, ...result } = decision;
  return result;
}

function renderDisplayArtifact(handoff: TownPortalDisplayAdapterHandoff): string {
  return [
    "# Town Portal Lab Display Artifact",
    "",
    "status: accepted",
    `operation: ${handoff.operation}`,
    `payload_kind: ${handoff.payload_kind}`,
    `state_hash: ${handoff.state_hash}`,
    "",
    handoff.body,
    ""
  ].join("\n");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
