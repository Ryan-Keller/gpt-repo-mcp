import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PortfolioConsoleState, PortfolioConsoleStatePatch } from "../contracts/portfolio-console-state.contract.js";

const EMPTY: PortfolioConsoleState = { version: 1, updated_at: "", project_seen: [], playbooks: [], artifacts: [] };

export class PortfolioConsoleStateService {
  private static readonly queues = new Map<string, Promise<void>>();
  private readonly path: string;

  constructor(repoRoot: string) {
    this.path = join(repoRoot, ".chatgpt", "operations-console-state.json");
  }

  async read(): Promise<PortfolioConsoleState> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<PortfolioConsoleState>;
      return {
        version: 1,
        updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : "",
        project_seen: Array.isArray(parsed.project_seen) ? parsed.project_seen : [],
        playbooks: Array.isArray(parsed.playbooks) ? parsed.playbooks : [],
        artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY, project_seen: [], playbooks: [], artifacts: [] };
      throw error;
    }
  }

  async update(patch: PortfolioConsoleStatePatch): Promise<PortfolioConsoleState> {
    const previous = PortfolioConsoleStateService.queues.get(this.path) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    PortfolioConsoleStateService.queues.set(this.path, queued);
    await previous;
    try {
      const state = await this.read();
      const now = new Date().toISOString();
      if (patch.project_seen) {
        const seen = new Map(state.project_seen.map((item) => [item.project_id, item.seen_at]));
        for (const item of patch.project_seen) seen.set(item.project_id, item.seen_at);
        state.project_seen = [...seen].map(([project_id, seen_at]) => ({ project_id, seen_at }));
      }
      if (patch.upsert_playbook) {
        state.playbooks = state.playbooks.filter((item) => item.name !== patch.upsert_playbook?.name);
        state.playbooks.push({ ...patch.upsert_playbook, updated_at: now });
        state.playbooks.sort((a, b) => a.name.localeCompare(b.name));
      }
      if (patch.delete_playbook) state.playbooks = state.playbooks.filter((item) => item.name !== patch.delete_playbook);
      if (patch.upsert_artifact) {
        state.artifacts = state.artifacts.filter((item) => item.artifact_id !== patch.upsert_artifact?.artifact_id);
        state.artifacts.push(patch.upsert_artifact);
      }
      if (patch.delete_artifact) state.artifacts = state.artifacts.filter((item) => item.artifact_id !== patch.delete_artifact);
      state.updated_at = now;
      await this.write(state);
      return state;
    } finally {
      release();
      if (PortfolioConsoleStateService.queues.get(this.path) === queued) PortfolioConsoleStateService.queues.delete(this.path);
    }
  }

  private async write(value: PortfolioConsoleState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, this.path);
  }
}
