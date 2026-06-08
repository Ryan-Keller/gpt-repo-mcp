import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ProjectMemoryDashboardResult, ProjectMemoryInput } from "../contracts/project-memory.contract.js";
import type { PathSandbox } from "./path-sandbox.js";
import type { RepoConfig } from "./root-registry.js";

const MEMORY_ROOT = ".chatgpt/project-memory";
const PROJECTS_PATH = `${MEMORY_ROOT}/projects.json`;
const DREAM_TEMPLATE_PATH = `${MEMORY_ROOT}/dream-report-template.md`;

const MemoryProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  phase: z.string(),
  product_track: z.string(),
  confidence: z.string(),
  summary: z.string(),
  roadmap: z.array(z.object({
    milestone: z.string(),
    state: z.string(),
    next_step: z.string()
  })).default([]),
  paused_ideas: z.array(z.object({
    title: z.string(),
    reason_paused: z.string(),
    next_tiny_experiment: z.string()
  })).default([]),
  decisions: z.array(z.object({
    title: z.string(),
    decision: z.string(),
    confidence: z.string()
  })).default([]),
  research_watchlist: z.array(z.object({
    topic: z.string(),
    cadence: z.string(),
    status: z.string()
  })).default([]),
  risks: z.array(z.object({
    risk: z.string(),
    mitigation: z.string()
  })).default([]),
  recent_results: z.array(z.object({
    date: z.string(),
    summary: z.string(),
    source: z.string()
  })).default([]),
  suggested_next_moves: z.array(z.string()).default([])
});

const ProjectMemoryFileSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string(),
  projects: z.array(MemoryProjectSchema)
});

type ProjectMemoryOptions = Omit<ProjectMemoryInput, "repo_id">;

export class ProjectMemoryService {
  constructor(private readonly repo: RepoConfig, private readonly sandbox: PathSandbox) {}

  async dashboard(options: ProjectMemoryOptions = {}): Promise<ProjectMemoryDashboardResult> {
    const warnings: string[] = [];
    const memory = await this.readProjectMemory(warnings);
    const projects = memory?.projects.filter((project) => options.include_archived || project.status !== "archived") ?? [];

    return {
      ok: true,
      repo_id: this.repo.repo_id,
      memory_root: MEMORY_ROOT,
      generated_at: memory?.generated_at ?? "",
      project_count: projects.length,
      active_projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        phase: project.phase,
        product_track: project.product_track,
        confidence: project.confidence,
        summary: project.summary
      })),
      roadmap: projects.flatMap((project) => project.roadmap.map((item) => ({
        project_id: project.id,
        project_name: project.name,
        milestone: item.milestone,
        state: item.state,
        next_step: item.next_step
      }))),
      paused_ideas: projects.flatMap((project) => project.paused_ideas.map((idea) => ({
        project_id: project.id,
        project_name: project.name,
        title: idea.title,
        reason_paused: idea.reason_paused,
        next_tiny_experiment: idea.next_tiny_experiment
      }))),
      research_watchlist: projects.flatMap((project) => project.research_watchlist.map((item) => ({
        project_id: project.id,
        project_name: project.name,
        topic: item.topic,
        cadence: item.cadence,
        status: item.status
      }))),
      recent_results: projects.flatMap((project) => project.recent_results.map((result) => ({
        project_id: project.id,
        project_name: project.name,
        date: result.date,
        summary: result.summary,
        source: result.source
      }))),
      suggested_next_moves: projects.flatMap((project) => project.suggested_next_moves.map((move) => ({
        project_id: project.id,
        move
      }))),
      dream_report_template_path: DREAM_TEMPLATE_PATH,
      warnings
    };
  }

  private async readProjectMemory(warnings: string[]) {
    try {
      const resolved = await this.sandbox.resolve(PROJECTS_PATH);
      const raw = await readFile(resolved.absolutePath, "utf8");
      const json = JSON.parse(raw) as unknown;
      const parsed = ProjectMemoryFileSchema.safeParse(json);
      if (!parsed.success) {
        warnings.push("PROJECT_MEMORY_PARSE_ERROR");
        return undefined;
      }
      return parsed.data;
    } catch (error) {
      warnings.push(error instanceof SyntaxError ? "PROJECT_MEMORY_PARSE_ERROR" : "PROJECT_MEMORY_NOT_FOUND");
      return undefined;
    }
  }
}
