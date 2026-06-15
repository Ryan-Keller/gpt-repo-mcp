import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";

const PORTAL_INBOX_PATH = "shared/portals/inbox.md";
const PORTAL_OBJECTS_DIR = "shared/portals/objects";
const PORTAL_RECEIPTS_DIR = "shared/portals/receipts";
const STATUS_ORDER = [
  "active",
  "open",
  "returned",
  "accepted",
  "parked",
  "stale",
  "conflicted",
  "rejected",
  "consumed",
  "expired"
];

type PortalObject = {
  id: string;
  type?: string;
  archetype?: string;
  lane?: string;
  opened_at?: string;
  expires_at?: string;
  allowed_paths?: string[];
  allowed_operation?: string;
  observed_state_hash?: string;
  target_return_path?: string;
  status?: string;
  return_card?: {
    kind?: string;
    summary?: string;
    artifact_path?: string;
    evidence_links?: string[];
    next_requested_decision?: string;
    observed_state_hash?: string;
    target_return_path?: string;
  };
  evidence_links?: string[];
  consumed_at?: string | null;
  consumed_by?: Record<string, unknown> | null;
  session_metadata?: Record<string, unknown>;
  next_requested_decision?: string;
  revision?: number;
  latest_receipt_path?: string;
};

type PortalReceipt = {
  receipt_type?: string;
  portal_id?: string;
  from_status?: string;
  to_status?: string;
  recorded_at?: string;
  recorded_by?: Record<string, unknown>;
  expected_revision?: number;
  new_revision?: number;
  observed_state_hash?: string;
  target_return_path?: string;
  next_requested_decision?: string;
  summary?: string;
};

export type PortalInboxReadResult = {
  ok: true;
  state: "available" | "unavailable" | "blocked";
  surface: "read_only_portal_inbox_v0";
  source_paths: {
    inbox_md: string;
    objects_dir: string;
    receipts_dir: string;
  };
  counts: {
    total_portals: number;
    status_groups: number;
    selected_receipt_count: number;
  };
  status_groups: Array<{
    status: string;
    count: number;
    cards: Array<{
      portal_id: string;
      status: string;
      type: string;
      archetype: string;
      lane: string;
      opened_at: string;
      expires_at: string;
      summary: string;
      object_path: string;
      latest_receipt_path: string;
      next_requested_decision: string;
    }>;
  }>;
  selection: {
    portal_id: string;
    found: boolean;
  };
  selected_portal: (PortalObject & { object_path: string }) | null;
  receipts: Array<{
    receipt_path: string;
    receipt_type: string;
    from_status: string;
    to_status: string;
    recorded_at: string;
    recorded_by: Record<string, unknown>;
    expected_revision: number | null;
    new_revision: number | null;
    target_return_path: string;
    next_requested_decision: string;
    summary: string;
  }>;
  warnings: string[];
};

export class PortalInboxService {
  constructor(private readonly repoRoot: string) {}

  async read(input: { portal_id?: string } = {}): Promise<PortalInboxReadResult> {
    const warnings: string[] = [];
    const portalId = normalizePortalId(input.portal_id);
    const inboxPath = join(this.repoRoot, PORTAL_INBOX_PATH);
    const objectsDir = join(this.repoRoot, PORTAL_OBJECTS_DIR);
    const receiptsDir = join(this.repoRoot, PORTAL_RECEIPTS_DIR);

    try {
      await readFile(inboxPath, "utf8");
    } catch {
      warnings.push("PORTAL_INBOX_MISSING");
    }

    const portals = await this.readPortalObjects(objectsDir, warnings);
    const statusGroups = buildStatusGroups(portals);
    const selectedPortal = portalId ? portals.find((portal) => portal.id === portalId) ?? null : null;
    const receipts = selectedPortal
      ? await this.readPortalReceipts(receiptsDir, selectedPortal.id, warnings)
      : [];

    if (portalId && !selectedPortal) {
      warnings.push("PORTAL_ID_NOT_FOUND");
    }

    return {
      ok: true,
      state: portals.length > 0 ? "available" : warnings.length > 0 ? "blocked" : "unavailable",
      surface: "read_only_portal_inbox_v0",
      source_paths: {
        inbox_md: PORTAL_INBOX_PATH,
        objects_dir: PORTAL_OBJECTS_DIR,
        receipts_dir: PORTAL_RECEIPTS_DIR
      },
      counts: {
        total_portals: portals.length,
        status_groups: statusGroups.length,
        selected_receipt_count: receipts.length
      },
      status_groups: statusGroups,
      selection: {
        portal_id: portalId,
        found: Boolean(selectedPortal)
      },
      selected_portal: selectedPortal ? sanitizePortal(selectedPortal) : null,
      receipts,
      warnings: [...new Set(warnings)]
    };
  }

  private async readPortalObjects(objectsDir: string, warnings: string[]): Promise<Array<PortalObject & { object_path: string }>> {
    let entries: string[] = [];
    try {
      entries = (await readdir(objectsDir)).filter((entry) => entry.endsWith(".json"));
    } catch {
      warnings.push("PORTAL_OBJECTS_MISSING");
      return [];
    }

    const portals = await Promise.all(entries.map(async (entry) => {
      const absolutePath = join(objectsDir, entry);
      try {
        const raw = JSON.parse(await readFile(absolutePath, "utf8")) as PortalObject;
        const portalId = typeof raw.id === "string" ? raw.id : "";
        if (!portalId) {
          warnings.push("PORTAL_OBJECT_ID_MISSING");
          return null;
        }
        return {
          ...raw,
          object_path: posix.join(PORTAL_OBJECTS_DIR, entry)
        };
      } catch {
        warnings.push("PORTAL_OBJECT_PARSE_FAILED");
        return null;
      }
    }));

    return portals
      .filter((portal): portal is PortalObject & { object_path: string } => portal !== null)
      .sort((left, right) => (right.opened_at ?? "").localeCompare(left.opened_at ?? ""));
  }

  private async readPortalReceipts(receiptsDir: string, portalId: string, warnings: string[]): Promise<PortalInboxReadResult["receipts"]> {
    const portalReceiptDir = join(receiptsDir, portalId);
    let entries: string[] = [];
    try {
      entries = (await readdir(portalReceiptDir)).filter((entry) => entry.endsWith(".json"));
    } catch {
      warnings.push("PORTAL_RECEIPTS_MISSING");
      return [];
    }

    const receipts = await Promise.all(entries.map(async (entry) => {
      const absolutePath = join(portalReceiptDir, entry);
      try {
        const raw = JSON.parse(await readFile(absolutePath, "utf8")) as PortalReceipt;
        return {
          receipt_path: posix.join(PORTAL_RECEIPTS_DIR, portalId, entry),
          receipt_type: stringOrEmpty(raw.receipt_type),
          from_status: stringOrEmpty(raw.from_status),
          to_status: stringOrEmpty(raw.to_status),
          recorded_at: stringOrEmpty(raw.recorded_at),
          recorded_by: asRecord(raw.recorded_by),
          expected_revision: typeof raw.expected_revision === "number" ? raw.expected_revision : null,
          new_revision: typeof raw.new_revision === "number" ? raw.new_revision : null,
          target_return_path: stringOrEmpty(raw.target_return_path),
          next_requested_decision: stringOrEmpty(raw.next_requested_decision),
          summary: compactString(raw.summary)
        };
      } catch {
        warnings.push("PORTAL_RECEIPT_PARSE_FAILED");
        return null;
      }
    }));

    return receipts
      .filter((receipt): receipt is PortalInboxReadResult["receipts"][number] => receipt !== null)
      .sort((left, right) => (right.recorded_at || right.receipt_path).localeCompare(left.recorded_at || left.receipt_path));
  }
}

function buildStatusGroups(portals: Array<PortalObject & { object_path: string }>): PortalInboxReadResult["status_groups"] {
  const grouped = new Map<string, PortalInboxReadResult["status_groups"][number]["cards"]>();
  for (const portal of portals) {
    const status = stringOrEmpty(portal.status) || "unknown";
    const cards = grouped.get(status) ?? [];
    cards.push({
      portal_id: portal.id,
      status,
      type: stringOrEmpty(portal.type),
      archetype: stringOrEmpty(portal.archetype),
      lane: stringOrEmpty(portal.lane),
      opened_at: stringOrEmpty(portal.opened_at),
      expires_at: stringOrEmpty(portal.expires_at),
      summary: compactString(portal.return_card?.summary),
      object_path: portal.object_path,
      latest_receipt_path: stringOrEmpty(portal.latest_receipt_path),
      next_requested_decision: stringOrEmpty(portal.next_requested_decision || portal.return_card?.next_requested_decision)
    });
    grouped.set(status, cards);
  }

  return [...grouped.entries()]
    .sort((left, right) => statusSort(left[0], right[0]))
    .map(([status, cards]) => ({
      status,
      count: cards.length,
      cards: cards.sort((left, right) => right.opened_at.localeCompare(left.opened_at))
    }));
}

function sanitizePortal(portal: PortalObject & { object_path: string }): PortalObject & { object_path: string } {
  return {
    id: portal.id,
    type: stringOrEmpty(portal.type),
    archetype: stringOrEmpty(portal.archetype),
    lane: stringOrEmpty(portal.lane),
    opened_at: stringOrEmpty(portal.opened_at),
    expires_at: stringOrEmpty(portal.expires_at),
    allowed_paths: Array.isArray(portal.allowed_paths) ? portal.allowed_paths.map((value) => compactString(value, 160)) : [],
    allowed_operation: stringOrEmpty(portal.allowed_operation),
    observed_state_hash: stringOrEmpty(portal.observed_state_hash),
    target_return_path: stringOrEmpty(portal.target_return_path),
    status: stringOrEmpty(portal.status),
    return_card: portal.return_card ? {
      kind: stringOrEmpty(portal.return_card.kind),
      summary: compactString(portal.return_card.summary),
      artifact_path: stringOrEmpty(portal.return_card.artifact_path),
      evidence_links: Array.isArray(portal.return_card.evidence_links) ? portal.return_card.evidence_links.map((value) => compactString(value, 160)) : [],
      next_requested_decision: stringOrEmpty(portal.return_card.next_requested_decision),
      observed_state_hash: stringOrEmpty(portal.return_card.observed_state_hash),
      target_return_path: stringOrEmpty(portal.return_card.target_return_path)
    } : undefined,
    evidence_links: Array.isArray(portal.evidence_links) ? portal.evidence_links.map((value) => compactString(value, 160)) : [],
    consumed_at: typeof portal.consumed_at === "string" ? portal.consumed_at : null,
    consumed_by: asRecord(portal.consumed_by),
    session_metadata: asRecord(portal.session_metadata),
    next_requested_decision: stringOrEmpty(portal.next_requested_decision),
    revision: typeof portal.revision === "number" ? portal.revision : 0,
    latest_receipt_path: stringOrEmpty(portal.latest_receipt_path),
    object_path: portal.object_path
  };
}

function normalizePortalId(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function compactString(value: unknown, maxLength = 240): string {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...` : text;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function statusSort(left: string, right: string): number {
  const leftIndex = STATUS_ORDER.indexOf(left);
  const rightIndex = STATUS_ORDER.indexOf(right);
  if (leftIndex === -1 && rightIndex === -1) {
    return left.localeCompare(right);
  }
  if (leftIndex === -1) {
    return 1;
  }
  if (rightIndex === -1) {
    return -1;
  }
  return leftIndex - rightIndex;
}
