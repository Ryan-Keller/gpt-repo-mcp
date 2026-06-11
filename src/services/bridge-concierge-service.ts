import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BridgeConciergeResult } from "../contracts/bridge-concierge.contract.js";
import type { RepoConfig } from "./root-registry.js";

type MemoryProject = {
  key?: string;
  id?: string;
  label?: string;
  name?: string;
  status?: string;
  phase?: string;
  product_track?: string;
  confidence?: string;
  summary?: string;
  evidence?: string[];
  roadmap?: Array<{ item?: string; milestone?: string; state?: string; next_step?: string }>;
  risks?: Array<{ risk?: string; mitigation?: string }>;
  recent_results?: Array<{ date?: string; summary?: string; source?: string }>;
  next_moves?: string[];
  suggested_next_moves?: string[];
};

type StatusNote = {
  path: string;
  title: string;
  status: string;
  date: string;
  summary: string;
  next: string[];
  issues: string[];
  score: number;
};

const PROJECT_MEMORY_PATH = "shared/state/project_memory_v1.json";
const STATUS_ROOT = "shared/status";
const MAX_STATUS_NOTES = 8;

export class BridgeConciergeService {
  constructor(private readonly repo: RepoConfig) {}

  async answer(input: { request: string; include_evidence?: boolean }): Promise<BridgeConciergeResult> {
    const warnings: string[] = [];
    const request = input.request.trim();
    const terms = tokenize(request);
    const mode = isDigestRequest(request) ? "workspace_digest" : "destination_status";
    const projects = await this.readProjects(warnings);
    const statusNotes = await this.readStatusNotes(terms, mode, warnings);
    const project = this.chooseProject(projects, terms, statusNotes);
    const destination = project
      ? destinationFromProject(project, statusNotes)
      : destinationFromStatus(statusNotes, request, mode);
    const currentStatus = currentStatusFor(project, statusNotes, mode);
    const latestProgress = latestProgressFor(project, statusNotes, mode);
    const openIssues = openIssuesFor(project, statusNotes);
    const recommendedNextAction = recommendedNextActionFor(project, statusNotes, mode);
    const evidence = input.include_evidence === false ? [] : evidenceFor(project, statusNotes);
    const known = knownFor(project, statusNotes, currentStatus, latestProgress);
    const inferred = inferredFor(project, statusNotes, request);
    const unknown = unknownFor(project, statusNotes, mode);
    const nextToolHints = [
      {
        tool: "repo_runner_status",
        reason: "Refresh live runner, queue, active, pending, stale-lock, completed, and blocked status before claiming execution state.",
        stop_condition: "live_runner_status_received"
      },
      {
        tool: "repo_project_memory",
        reason: "Use persistent project memory when more project-wide context is needed after this destination packet.",
        stop_condition: "project_context_received"
      }
    ];
    const plainText = renderPlainText({
      label: destination.label,
      currentStatus,
      latestProgress,
      openIssues,
      recommendedNextAction,
      known,
      inferred,
      unknown
    });

    return {
      ok: true,
      repo_id: this.repo.repo_id,
      request,
      mode,
      destination,
      current_status: currentStatus,
      latest_progress: latestProgress,
      open_issues: openIssues,
      recommended_next_action: recommendedNextAction,
      known,
      inferred,
      unknown,
      evidence,
      next_tool_hints: nextToolHints,
      plain_text: plainText,
      warnings
    };
  }

  private async readProjects(warnings: string[]): Promise<MemoryProject[]> {
    try {
      const raw = await readFile(join(this.repo.root, PROJECT_MEMORY_PATH), "utf8");
      const parsed = JSON.parse(raw) as { projects?: MemoryProject[] };
      return Array.isArray(parsed.projects) ? parsed.projects : [];
    } catch (error) {
      warnings.push(error instanceof SyntaxError ? "PROJECT_MEMORY_PARSE_ERROR" : "PROJECT_MEMORY_NOT_FOUND");
      return [];
    }
  }

  private async readStatusNotes(terms: string[], mode: "destination_status" | "workspace_digest", warnings: string[]): Promise<StatusNote[]> {
    try {
      const names = await readdir(join(this.repo.root, STATUS_ROOT));
      const candidates = names
        .filter((name) => name.endsWith(".md"))
        .sort((left, right) => right.localeCompare(left))
        .slice(0, mode === "workspace_digest" ? 80 : 160);
      const notes = await Promise.all(candidates.map(async (name) => {
        const path = `${STATUS_ROOT}/${name}`;
        const text = await readFile(join(this.repo.root, path), "utf8");
        return parseStatusNote(path, text, terms, mode);
      }));
      return notes
        .filter((note) => mode === "workspace_digest" || note.score > 0)
        .sort((left, right) => right.score - left.score || right.date.localeCompare(left.date))
        .slice(0, MAX_STATUS_NOTES);
    } catch {
      warnings.push("STATUS_NOTES_UNAVAILABLE");
      return [];
    }
  }

  private chooseProject(projects: MemoryProject[], terms: string[], notes: StatusNote[]): MemoryProject | undefined {
    let best: { project: MemoryProject; score: number } | undefined;
    for (const project of projects) {
      const haystack = [
        project.key,
        project.id,
        project.label,
        project.name,
        project.status,
        project.phase,
        project.product_track,
        project.summary,
        ...(project.evidence ?? [])
      ].join(" ");
      const score = scoreText(haystack, terms);
      if (!best || score > best.score) {
        best = { project, score };
      }
    }
    if (best && best.score > 0) {
      return best.project;
    }
    const topNote = notes[0];
    if (!topNote) {
      return projects.find((project) => project.key === "bridge" || project.id === "bridge") ?? projects[0];
    }
    const noteTerms = tokenize(topNote.title);
    return projects.find((project) => scoreText([project.key, project.label, project.name, project.product_track, project.summary].join(" "), noteTerms) > 0);
  }
}

function destinationFromProject(project: MemoryProject, notes: StatusNote[]): BridgeConciergeResult["destination"] {
  return {
    id: String(project.key ?? project.id ?? slug(project.label ?? project.name ?? "destination")),
    label: String(project.label ?? project.name ?? "Destination"),
    kind: "project",
    status: String(project.status ?? notes[0]?.status ?? "unknown"),
    phase: String(project.phase ?? "unknown"),
    product_track: String(project.product_track ?? "unknown"),
    confidence: confidence(project.confidence),
    match_confidence: notes.length > 0 ? "medium" : "high",
    match_reason: "Matched persistent project memory and relevant status evidence."
  };
}

function destinationFromStatus(notes: StatusNote[], request: string, mode: "destination_status" | "workspace_digest"): BridgeConciergeResult["destination"] {
  const top = notes[0];
  const label = mode === "workspace_digest" ? "Shared Agent Bridge" : top?.title ?? titleize(request);
  return {
    id: slug(label),
    label,
    kind: mode === "workspace_digest" ? "workspace" : "capability",
    status: top?.status ?? "unknown",
    phase: "status-derived",
    product_track: "Derived from recent status notes.",
    confidence: top ? "medium" : "low",
    match_confidence: top ? "medium" : "low",
    match_reason: top ? "Matched recent status note text." : "No direct destination match found; returned safest workspace-level packet."
  };
}

function currentStatusFor(project: MemoryProject | undefined, notes: StatusNote[], mode: string): string {
  if (mode === "workspace_digest") {
    return notes.length ? `${notes.length} recent status notes are available for digest.` : "No recent status notes were available for digest.";
  }
  if (notes[0]) {
    return `${notes[0].title}: ${notes[0].status || "status unknown"}. ${notes[0].summary}`;
  }
  return project?.summary ?? "Destination status is unknown from current local evidence.";
}

function latestProgressFor(project: MemoryProject | undefined, notes: StatusNote[], mode: string): string[] {
  const progress = notes.map((note) => `${note.date || "undated"}: ${note.title} - ${note.summary || note.status}`);
  if (progress.length) {
    return progress.slice(0, mode === "workspace_digest" ? 6 : 4);
  }
  return (project?.recent_results ?? []).map((result) => `${result.date ?? "undated"}: ${result.summary ?? ""}`).filter(Boolean).slice(0, 4);
}

function openIssuesFor(project: MemoryProject | undefined, notes: StatusNote[]): string[] {
  const issues = [
    ...notes.flatMap((note) => note.issues),
    ...(project?.risks ?? []).map((risk) => `${risk.risk ?? "Risk"} Mitigation: ${risk.mitigation ?? "unknown"}`)
  ].filter(Boolean);
  return issues.length ? dedupe(issues).slice(0, 5) : ["No open issue was proven by the matched local evidence."];
}

function recommendedNextActionFor(project: MemoryProject | undefined, notes: StatusNote[], mode: string): string {
  const noteNext = notes.flatMap((note) => note.next).find(Boolean);
  if (noteNext) {
    return noteNext;
  }
  const projectNext = project?.next_moves?.[0] ?? project?.suggested_next_moves?.[0] ?? project?.roadmap?.find((item) => item.next_step)?.next_step;
  if (projectNext) {
    return projectNext;
  }
  return mode === "workspace_digest"
    ? "Call repo_runner_status, then review the top recent status notes before creating new work."
    : "Refresh live runner/status evidence, then decide the smallest bounded follow-up.";
}

function evidenceFor(project: MemoryProject | undefined, notes: StatusNote[]): Array<{ path: string; note: string }> {
  const projectEvidence = (project?.evidence ?? []).map((path) => ({ path, note: "persistent project memory evidence" }));
  const noteEvidence = notes.map((note) => ({ path: note.path, note: `${note.title}; status ${note.status || "unknown"}` }));
  return dedupeEvidence([...noteEvidence, ...projectEvidence]).slice(0, 10);
}

function knownFor(project: MemoryProject | undefined, notes: StatusNote[], currentStatus: string, latestProgress: string[]): string[] {
  return dedupe([
    currentStatus,
    ...latestProgress,
    project ? `Persistent memory identifies ${project.label ?? project.name ?? project.key ?? project.id}.` : ""
  ].filter(Boolean)).slice(0, 6);
}

function inferredFor(project: MemoryProject | undefined, notes: StatusNote[], request: string): string[] {
  const inferred = [];
  if (!project && notes.length > 0) {
    inferred.push(`The request "${request}" appears to target ${notes[0].title} based on status-note keyword overlap.`);
  }
  if (project && notes.length > 0) {
    inferred.push("Latest progress is inferred by combining persistent memory with matched recent status notes.");
  }
  return inferred;
}

function unknownFor(project: MemoryProject | undefined, notes: StatusNote[], mode: string): string[] {
  const unknown = [];
  if (!project) {
    unknown.push("No persistent project-memory entry exactly matched this destination.");
  }
  if (!notes.length) {
    unknown.push("No matching recent status note was found.");
  }
  unknown.push("Live ChatGPT-callable exposure is not proven by this read-only packet; use the live tool guard after MCP catalog changes.");
  if (mode === "workspace_digest") {
    unknown.push("Overnight means recent local status evidence, not a verified human sleep window.");
  }
  return unknown;
}

function parseStatusNote(path: string, text: string, terms: string[], mode: string): StatusNote {
  const lines = text.split(/\r?\n/);
  const title = lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim() || path;
  const status = field(lines, "status") || "unknown";
  const date = field(lines, "date") || path.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
  const summary = section(text, "Summary") || firstParagraph(lines) || status;
  const nextText = section(text, "Next Recommended Slice") || section(text, "Future Work") || section(text, "Recommended Next Action");
  const issueText = section(text, "Boundaries") || section(text, "Boundary") || section(text, "Open Issues") || section(text, "Future Work");
  const score = mode === "workspace_digest" ? dateScore(date) : scoreText(`${path} ${title} ${text}`, terms) + dateScore(date);
  return {
    path,
    title,
    status,
    date,
    summary: compact(summary),
    next: bullets(nextText).slice(0, 3),
    issues: bullets(issueText).slice(0, 4),
    score
  };
}

function field(lines: string[], name: string): string {
  const prefix = `${name}:`;
  return lines.find((line) => line.toLowerCase().startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

function section(text: string, heading: string): string {
  const match = text.match(new RegExp(`## ${escapeRegExp(heading)}\\s+([\\s\\S]*?)(\\n## |$)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function firstParagraph(lines: string[]): string {
  return lines.filter((line) => line.trim() && !line.startsWith("#") && !/^\w+:/i.test(line)).slice(0, 3).join(" ");
}

function bullets(text: string): string[] {
  if (!text.trim()) {
    return [];
  }
  const listed: string[] = [];
  let current = "";
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("- ")) {
      if (current) {
        listed.push(compact(current));
      }
      current = line.replace(/^\s*-\s*/, "");
    } else if (current && line.trim() && !line.trim().startsWith("#")) {
      current = `${current} ${line.trim()}`;
    }
  }
  if (current) {
    listed.push(compact(current));
  }
  return listed.length ? listed : [compact(text)];
}

function renderPlainText(input: {
  label: string;
  currentStatus: string;
  latestProgress: string[];
  openIssues: string[];
  recommendedNextAction: string;
  known: string[];
  inferred: string[];
  unknown: string[];
}): string {
  return [
    input.label,
    "",
    "Current status:",
    input.currentStatus,
    "",
    "Latest progress:",
    ...input.latestProgress.map((item) => `- ${item}`),
    "",
    "Open issues:",
    ...input.openIssues.map((item) => `- ${item}`),
    "",
    "Recommended next action:",
    input.recommendedNextAction,
    "",
    "Known:",
    ...input.known.map((item) => `- ${item}`),
    "",
    "Inferred:",
    ...(input.inferred.length ? input.inferred.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Unknown:",
    ...input.unknown.map((item) => `- ${item}`)
  ].join("\n");
}

function tokenize(value: string): string[] {
  return dedupe(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((term) => term.length > 2 && !["the", "and", "for", "what", "how", "with", "status"].includes(term)));
}

function scoreText(text: string, terms: string[]): number {
  const haystack = text.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 3 : 0) + (haystack.includes(stem(term)) ? 1 : 0), 0);
}

function dateScore(date: string): number {
  if (date.startsWith("2026-06-11")) return 3;
  if (date.startsWith("2026-06-10")) return 2;
  if (date.startsWith("2026-06-09")) return 1;
  return 0;
}

function isDigestRequest(request: string): boolean {
  return /overnight|what happened|work on next|next\?|next$|today|recent/i.test(request);
}

function confidence(value: string | undefined): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "destination";
}

function titleize(value: string): string {
  return value.trim().replace(/\b\w/g, (char) => char.toUpperCase());
}

function stem(value: string): string {
  return value.replace(/ing$|ed$|s$/g, "");
}

function compact(value: string): string {
  return value.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function dedupeEvidence(values: Array<{ path: string; note: string }>): Array<{ path: string; note: string }> {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.path)) return false;
    seen.add(value.path);
    return true;
  });
}
