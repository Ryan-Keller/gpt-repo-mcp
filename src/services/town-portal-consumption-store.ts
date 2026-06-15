import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type TownPortalTerminalStatus = "accepted" | "rejected" | "expired" | "conflict";

export type TownPortalConsumptionRecord = {
  schema_version: 1;
  kind: "town_portal_consumption_record";
  portal_id: string;
  repo_id: "shared-agent-bridge";
  target_path: string;
  status: TownPortalTerminalStatus;
  reason: string;
  operation: string;
  payload_kind: string;
  adapter: "knowledge_display_write_v0";
  state_hash: string;
  consumed_at: string;
};

export type TownPortalConsumptionWriteResult =
  | {
      written: true;
      record: TownPortalConsumptionRecord;
      path: string;
    }
  | {
      written: false;
      existing: TownPortalConsumptionRecord;
      path: string;
      reason: "portal_already_consumed";
    };

export class TownPortalConsumptionStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  async has(portalId: string): Promise<boolean> {
    return (await this.read(portalId)) !== undefined;
  }

  async read(portalId: string): Promise<TownPortalConsumptionRecord | undefined> {
    const path = this.recordPath(portalId);
    try {
      return JSON.parse(await readFile(path, "utf8")) as TownPortalConsumptionRecord;
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async recordTerminal(record: TownPortalConsumptionRecord): Promise<TownPortalConsumptionWriteResult> {
    validateRecord(record);
    const path = this.recordPath(record.portal_id);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return { written: true, record, path };
    } catch (error) {
      if (!isExistingFile(error)) {
        throw error;
      }
      const existing = JSON.parse(await readFile(path, "utf8")) as TownPortalConsumptionRecord;
      return {
        written: false,
        existing,
        path,
        reason: "portal_already_consumed"
      };
    }
  }

  recordPath(portalId: string): string {
    assertSafePortalId(portalId);
    return resolve(this.rootDir, `${portalId}.json`);
  }
}

export function createTownPortalConsumptionRecord(input: Omit<TownPortalConsumptionRecord, "schema_version" | "kind" | "consumed_at"> & {
  consumed_at?: string;
}): TownPortalConsumptionRecord {
  return {
    schema_version: 1,
    kind: "town_portal_consumption_record",
    ...input,
    consumed_at: input.consumed_at ?? new Date().toISOString()
  };
}

function validateRecord(record: TownPortalConsumptionRecord): void {
  assertSafePortalId(record.portal_id);
  if (record.schema_version !== 1 || record.kind !== "town_portal_consumption_record") {
    throw new Error("invalid town portal consumption record schema");
  }
  if (!["accepted", "rejected", "expired", "conflict"].includes(record.status)) {
    throw new Error("town portal consumption record must be terminal");
  }
  if (record.repo_id !== "shared-agent-bridge") {
    throw new Error("town portal consumption record repo_id mismatch");
  }
  if (!record.operation || record.operation.length > 128) {
    throw new Error("town portal consumption record operation must be bounded");
  }
  if (!record.payload_kind || record.payload_kind.length > 128) {
    throw new Error("town portal consumption record payload kind must be bounded");
  }
  if (record.adapter !== "knowledge_display_write_v0") {
    throw new Error("town portal consumption record adapter mismatch");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(record.state_hash)) {
    throw new Error("town portal consumption record state_hash must be sha256");
  }
}

function assertSafePortalId(portalId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(portalId)) {
    throw new Error("unsafe town portal id");
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isExistingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
