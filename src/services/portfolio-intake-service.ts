import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DecisionBundleCommand, DecisionBundleRecord, IdeaCommand, IdeaRecord } from "../contracts/portfolio-intake.contract.js";

export class IdeaInboxService {
  private readonly path: string;
  constructor(repoRoot: string, private readonly now: () => Date = () => new Date()) { this.path = join(repoRoot, "shared", "ideas", "inbox.jsonl"); }
  async latest(): Promise<IdeaRecord[]> {
    try {
      const records = (await readFile(this.path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as IdeaRecord);
      return [...new Map(records.map((record) => [record.idea_id, record])).values()];
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async capture(input: IdeaCommand): Promise<IdeaRecord> {
    const now = this.now().toISOString(); const dedupe = hash(`${normalize(input.raw_phrase)}:${[...input.related_projects].sort().join(",")}`);
    const existing = (await this.latest()).find((record) => record.dedupe_key === dedupe && !["rejected", "promoted"].includes(record.status));
    const record: IdeaRecord = { ...input, idea_id: input.idea_id || existing?.idea_id || `idea-${now.replace(/\D/g, "").slice(0, 14)}-${dedupe.slice(0, 8)}`,
      captured_at: existing?.captured_at || now, updated_at: now, dedupe_key: dedupe };
    await mkdir(dirname(this.path), { recursive: true }); await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8"); return record;
  }
}

type BundleStore = { version: 1; updated_at: string; bundles: DecisionBundleRecord[] };
export class DecisionBundleService {
  private readonly path: string;
  constructor(repoRoot: string, private readonly now: () => Date = () => new Date()) { this.path = join(repoRoot, ".chatgpt", "decision-bundles-v1.json"); }
  async read(): Promise<DecisionBundleRecord[]> {
    try { return (JSON.parse(await readFile(this.path, "utf8")) as BundleStore).bundles ?? []; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async create(input: DecisionBundleCommand, actionIds: string[]): Promise<DecisionBundleRecord> {
    const bundles = await this.read(); const existing = bundles.find((bundle) => bundle.idempotency_key === input.idempotency_key);
    if (existing) return existing;
    const now = this.now().toISOString(); const record: DecisionBundleRecord = { ...input,
      bundle_id: input.bundle_id || `bundle-${hash(input.idempotency_key).slice(0, 16)}`, action_ids: [...new Set(actionIds)],
      state: "pending", launch_receipts: [], cancellation_reason: "", created_at: now, updated_at: now };
    await this.write([...bundles, record]); return record;
  }
  async cancel(id: string, reason: string): Promise<DecisionBundleRecord | undefined> {
    const bundles = await this.read(); const found = bundles.find((bundle) => bundle.bundle_id === id); if (!found) return undefined;
    const updated = { ...found, state: "cancelled" as const, cancellation_reason: reason, updated_at: this.now().toISOString() };
    await this.write([...bundles.filter((bundle) => bundle.bundle_id !== id), updated]); return updated;
  }
  private async write(bundles: DecisionBundleRecord[]) { const updated_at = this.now().toISOString(); await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify({ version: 1, updated_at, bundles }, null, 2)}\n`); await rename(temp, this.path); }
}
function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
