import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ProjectMemoryDashboardResult, ProjectMemoryInput } from "../contracts/project-memory.contract.js";
import type { PathSandbox } from "./path-sandbox.js";
import type { RepoConfig } from "./root-registry.js";

const MEMORY_ROOT = ".chatgpt/project-memory";
const PROJECTS_PATH = `${MEMORY_ROOT}/projects.json`;
const TRACKED_PROJECTS_PATH = "shared/state/project_memory_v1.json";
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
  artifacts: z.array(z.object({
    id: z.string(), title: z.string(),
    kind: z.enum(["image", "video", "audio", "document", "link", "other"]),
    source: z.string(), observed_at: z.string().default(""), mime_type: z.string().default(""),
    preview_url: z.string().default(""), open_url: z.string().default("")
  })).default([]),
  suggested_next_moves: z.array(z.string()).default([])
});

const ProjectMemoryFileSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string(),
  projects: z.array(MemoryProjectSchema)
});

const TrackedProjectSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.string(),
  phase: z.string(),
  product_track: z.string(),
  confidence: z.string(),
  summary: z.string(),
  roadmap: z.array(z.object({
    item: z.string(),
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
  next_moves: z.array(z.string()).default([])
});

const TrackedProjectMemoryFileSchema = z.object({
  schema_version: z.literal(1),
  updated_at: z.string(),
  projects: z.array(TrackedProjectSchema)
});

type MemoryProject = z.infer<typeof MemoryProjectSchema>;

const PROJECT_ID_ALIASES: Record<string, string> = {
  bridge: "shared-agent-bridge",
  shadefinder: "shade-finder"
};

const canonicalProjectId = (id: string): string => PROJECT_ID_ALIASES[id] ?? id;

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
      source_paths: memory?.source_paths ?? [],
      source_project_counts: memory?.source_project_counts ?? {},
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
      artifacts: projects.flatMap((project) => project.artifacts.map((artifact) => ({
        artifact_id: artifact.id,
        project_id: project.id,
        project_name: project.name,
        title: artifact.title,
        kind: artifact.kind,
        source: artifact.source,
        observed_at: artifact.observed_at,
        mime_type: artifact.mime_type,
        preview_url: artifact.preview_url,
        open_url: artifact.open_url
      }))),
      dream_report_template_path: DREAM_TEMPLATE_PATH,
      warnings
    };
  }

  private async readProjectMemory(warnings: string[]) {
    const local = await this.readSource(PROJECTS_PATH, ProjectMemoryFileSchema, "PROJECT_MEMORY_PARSE_ERROR", warnings);
    const tracked = await this.readSource(TRACKED_PROJECTS_PATH, TrackedProjectMemoryFileSchema, "TRACKED_PROJECT_MEMORY_PARSE_ERROR", warnings);

    if (!local && !tracked) {
      warnings.push("PROJECT_MEMORY_NOT_FOUND");
      return undefined;
    }

    const merged = new Map<string, MemoryProject>();
    for (const project of local?.projects ?? []) {
      const id = canonicalProjectId(project.id);
      merged.set(id, { ...project, id });
    }
    for (const project of tracked?.projects ?? []) {
      const id = canonicalProjectId(project.key);
      merged.set(id, MemoryProjectSchema.parse({
        id,
        name: project.label === "Bridge" ? "Shared Agent Bridge" : project.label,
        status: project.status,
        phase: project.phase,
        product_track: project.product_track,
        confidence: project.confidence,
        summary: project.summary,
        roadmap: project.roadmap.map((item) => ({
          milestone: item.item,
          state: item.state,
          next_step: item.next_step
        })),
        paused_ideas: project.paused_ideas,
        decisions: project.decisions,
        research_watchlist: project.research_watchlist,
        risks: project.risks,
        recent_results: project.recent_results,
        artifacts: [],
        suggested_next_moves: project.next_moves
      }));
    }

    const timestamps = [local?.generated_at, tracked?.updated_at]
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(b) - Date.parse(a));
    const source_paths = [local && PROJECTS_PATH, tracked && TRACKED_PROJECTS_PATH]
      .filter((value): value is string => Boolean(value));

    return {
      generated_at: timestamps[0] ?? "",
      projects: [...merged.values()],
      source_paths,
      source_project_counts: {
        ...(local ? { [PROJECTS_PATH]: local.projects.length } : {}),
        ...(tracked ? { [TRACKED_PROJECTS_PATH]: tracked.projects.length } : {})
      }
    };
  }

  private async readSource<T>(
    relativePath: string,
    schema: z.ZodType<T>,
    parseWarning: string,
    warnings: string[]
  ): Promise<T | undefined> {
    try {
      const resolved = await this.sandbox.resolve(relativePath);
      const raw = await readFile(resolved.absolutePath, "utf8");
      const parsed = schema.safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success) {
        warnings.push(parseWarning);
        return undefined;
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof SyntaxError) warnings.push(parseWarning);
      return undefined;
    }
  }
}
