/**
 * @fileType utility
 * @domain kody
 * @pattern reports-files
 * @ai-summary Read-only access to goal/loop reports in the configured Kody
 *   state repo. Supports legacy `reports/<slug>.md` files and append-only
 *   report families under `reports/<slug>/runs/<run>.md`.
 */

import { getOctokit, getOwner, getRepo } from "./github-client";
import {
  parseReportSuggestedActions,
  type ReportSuggestedAction,
} from "./report-suggested-actions";
import { listStateDirectory, readStateText } from "./state-repo";

export interface ReportFile {
  /** Report family slug — stable identity. */
  slug: string;
  /** State-repo-relative markdown path for the currently shown report. */
  path: string;
  /** Run id when this report came from `reports/<slug>/runs/<run>.md`. */
  runId: string | null;
  /** Available historical runs, newest first. Empty for legacy flat reports. */
  runs: ReportRun[];
  /** First H1 of the body, or humanized slug fallback. */
  title: string;
  /** Markdown body (post-H1 if present, else the entire file). */
  body: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
  /** Size in bytes (helps preview length without fetching body). */
  size: number;
  /** Producer capability metadata from report frontmatter. */
  capabilitySlug: string | null;
  /** Review routing status, from report frontmatter. */
  reviewStatus: string | null;
  /** Review routing area, from report frontmatter. */
  reviewArea: string | null;
  /** Count of structured findings declared in report frontmatter. */
  findingCount: number;
  /** Action buttons suggested by report frontmatter. */
  suggestedActions: ReportSuggestedAction[];
}

export interface ReportRun {
  id: string;
  path: string;
  generatedAt: string | null;
  htmlUrl: string;
  size: number;
}

const REPORTS_DIR = "reports";
const RUNS_DIR = "runs";
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitReportFrontmatter(raw: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatter: null, body: raw };
  return {
    frontmatter: match[1] ?? "",
    body: raw.slice(match[0].length),
  };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function topLevelValue(frontmatter: string | null, key: string): string | null {
  if (!frontmatter) return null;
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!match) return null;
  const value = unquote(match[1] ?? "");
  return value.length > 0 ? value : null;
}

function countFindings(frontmatter: string | null): number {
  if (!frontmatter) return 0;
  return (frontmatter.match(/^\s{2}-\s+id:\s*/gm) ?? []).length;
}

function slugFromName(name: string): string | null {
  if (!name.endsWith(".md")) return null;
  const slug = name.slice(0, -".md".length);
  if (slug.length === 0 || slug.startsWith(".") || slug.startsWith("_"))
    return null;
  return slug;
}

function runIdFromName(name: string): string | null {
  if (!name.endsWith(".md")) return null;
  const id = name.slice(0, -".md".length);
  if (id.length === 0 || id.startsWith(".") || id.startsWith("_")) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)) return null;
  return id;
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

export function isValidRunId(runId: string): boolean {
  return runIdFromName(`${runId}.md`) === runId;
}

function runIdToIso(id: string): string | null {
  const normalized = id.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, "T$1:$2:$3Z");
  return Number.isNaN(Date.parse(normalized)) ? null : normalized;
}

function deriveTitle(body: string, slug: string): string {
  const firstLine = body.trimStart().split("\n", 1)[0] ?? "";
  const h1 = /^#\s+(.+?)\s*$/.exec(firstLine);
  if (h1) return h1[1]!.trim();
  return slug
    .split(/[-_]+/)
    .filter((s) => s.length > 0)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join(" ");
}

function stripLeadingH1(body: string): string {
  const trimmed = body.replace(/^﻿/, "");
  const lines = trimmed.split("\n");
  if (lines.length > 0 && /^#\s+.+/.test(lines[0]!)) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return trimmed;
}

function parseReportMarkdown(raw: string, slug: string) {
  const { frontmatter, body: afterFrontmatter } = splitReportFrontmatter(raw);
  return {
    generatedAt: topLevelValue(frontmatter, "generatedAt"),
    title: deriveTitle(afterFrontmatter, slug),
    body: stripLeadingH1(afterFrontmatter),
    capabilitySlug:
      topLevelValue(frontmatter, "capabilitySlug") ??
      topLevelValue(frontmatter, "capabilitySlug"),
    reviewStatus: topLevelValue(frontmatter, "reviewStatus"),
    reviewArea: topLevelValue(frontmatter, "reviewArea"),
    findingCount: countFindings(frontmatter),
    suggestedActions: parseReportSuggestedActions(frontmatter),
  };
}

function sortRunsNewestFirst(a: ReportRun, b: ReportRun): number {
  const at = a.generatedAt ?? a.id;
  const bt = b.generatedAt ?? b.id;
  return bt.localeCompare(at);
}

async function readReportAtPath({
  slug,
  path,
  size,
  runId = null,
  runs = [],
}: {
  slug: string;
  path: string;
  size: number;
  runId?: string | null;
  runs?: ReportRun[];
}): Promise<ReportFile | null> {
  const octokit = getOctokit();
  const owner = getOwner();
  const repo = getRepo();
  const file = await readStateText(octokit, owner, repo, path);
  if (!file) return null;
  const raw = file.content;
  const parsed = parseReportMarkdown(raw, slug);
  const generatedAt =
    parsed.generatedAt ?? runs.find((run) => run.id === runId)?.generatedAt;
  return {
    slug,
    path,
    runId,
    runs,
    title: parsed.title,
    body: parsed.body,
    updatedAt: generatedAt ?? new Date().toISOString(),
    htmlUrl: file.htmlUrl ?? "",
    size: file.size ?? size,
    capabilitySlug: parsed.capabilitySlug,
    reviewStatus: parsed.reviewStatus,
    reviewArea: parsed.reviewArea,
    findingCount: parsed.findingCount,
    suggestedActions: parsed.suggestedActions,
  };
}

async function listReportRuns(slug: string): Promise<ReportRun[]> {
  const octokit = getOctokit();
  const owner = getOwner();
  const repo = getRepo();
  const { entries } = await listStateDirectory(
    octokit,
    owner,
    repo,
    `${REPORTS_DIR}/${slug}/${RUNS_DIR}`,
  );
  const runs = entries
    .filter((entry) => entry.type === "file")
    .map((entry) => {
      const id = runIdFromName(entry.name);
      if (!id) return null;
      return {
        id,
        path: `${REPORTS_DIR}/${slug}/${RUNS_DIR}/${entry.name}`,
        generatedAt: runIdToIso(id),
        htmlUrl: entry.htmlUrl ?? "",
        size: entry.size ?? 0,
      } satisfies ReportRun;
    })
    .filter((run): run is ReportRun => run !== null)
    .sort(sortRunsNewestFirst);

  return runs;
}

async function readRunReport(
  slug: string,
  runId?: string | null,
): Promise<ReportFile | null> {
  const runs = await listReportRuns(slug);
  const latest = runId ? runs.find((run) => run.id === runId) : runs[0];
  if (!latest) return null;
  return readReportAtPath({
    slug,
    path: latest.path,
    size: latest.size,
    runId: latest.id,
    runs,
  });
}

/**
 * List every report family under `reports/` in the configured Kody state repo.
 * Returns `[]` if the directory does not exist (fresh repo).
 */
export async function listReportFiles(): Promise<ReportFile[]> {
  const octokit = getOctokit();
  const owner = getOwner();
  const repo = getRepo();

  const { entries } = await listStateDirectory(
    octokit,
    owner,
    repo,
    REPORTS_DIR,
  );

  const flatReports = entries
    .filter((e) => e.type === "file")
    .map((e) => ({
      slug: slugFromName(e.name),
      name: e.name,
      size: e.size ?? 0,
    }))
    .filter(
      (e): e is { slug: string; name: string; size: number } => e.slug !== null,
    );

  const folderSlugs = entries
    .filter((e) => e.type === "dir" && isValidSlug(e.name))
    .map((e) => e.name);

  const flatFiles = await Promise.all(
    flatReports.map(async ({ slug, name, size }) => {
      try {
        const filePath = `${REPORTS_DIR}/${name}`;
        return await readReportAtPath({
          slug,
          path: filePath,
          size,
        });
      } catch {
        return null;
      }
    }),
  );

  const runFiles = await Promise.all(
    folderSlugs.map(async (slug) => {
      try {
        return await readRunReport(slug);
      } catch {
        return null;
      }
    }),
  );

  const bySlug = new Map<string, ReportFile>();
  for (const file of flatFiles) {
    if (file) bySlug.set(file.slug, file);
  }
  for (const file of runFiles) {
    if (file) bySlug.set(file.slug, file);
  }

  // Most recently produced first — reports are time-sensitive health signals.
  return [...bySlug.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

/**
 * Read a single report by slug. Returns `null` if the file does not exist.
 */
export async function readReportFile(
  slug: string,
  runId?: string | null,
): Promise<ReportFile | null> {
  if (!isValidSlug(slug)) return null;
  if (runId && !isValidRunId(runId)) return null;

  const runReport = await readRunReport(slug, runId);
  if (runReport) return runReport;
  if (runId) return null;

  try {
    return await readReportAtPath({
      slug,
      path: `${REPORTS_DIR}/${slug}.md`,
      size: 0,
    });
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}
