/**
 * @fileType utility
 * @domain kody
 * @pattern reports-files
 * @ai-summary Read-only access to system reports under `.kody/reports/<slug>.md`
 *   on the connected repo's dedicated state branch. Reports are produced by
 *   Kody duties (doc-drift, coverage-floor, etc.) — the dashboard surfaces
 *   them as a health view. No write operations: the engine owns this directory.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "./github-client";
import { STATE_BRANCH } from "./state-branch";

export interface ReportFile {
  /** Filename without `.md` — stable identity. */
  slug: string;
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
  /** Duty that produced this report, from report frontmatter. */
  dutySlug: string | null;
  /** Review routing status, from report frontmatter. */
  reviewStatus: string | null;
  /** Review routing area, from report frontmatter. */
  reviewArea: string | null;
  /** Count of structured findings declared in report frontmatter. */
  findingCount: number;
}

const REPORTS_DIR = ".kody/reports";
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

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
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
    title: deriveTitle(afterFrontmatter, slug),
    body: stripLeadingH1(afterFrontmatter),
    dutySlug: topLevelValue(frontmatter, "dutySlug"),
    reviewStatus: topLevelValue(frontmatter, "reviewStatus"),
    reviewArea: topLevelValue(frontmatter, "reviewArea"),
    findingCount: countFindings(frontmatter),
  };
}

function buildHtmlUrl(slug: string): string {
  return `https://github.com/${getOwner()}/${getRepo()}/blob/${STATE_BRANCH}/${REPORTS_DIR}/${slug}.md`;
}

async function fetchLastCommitDate(
  octokit: Octokit,
  filePath: string,
): Promise<string> {
  try {
    const { data } = await octokit.repos.listCommits({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      sha: STATE_BRANCH,
      per_page: 1,
    });
    return (
      data[0]?.commit.committer?.date ??
      data[0]?.commit.author?.date ??
      new Date().toISOString()
    );
  } catch {
    return new Date().toISOString();
  }
}

/**
 * List every report under `.kody/reports/` on the state branch. Returns `[]`
 * if the directory does not exist (fresh repo).
 */
export async function listReportFiles(): Promise<ReportFile[]> {
  const octokit = getOctokit();

  let entries: Array<{
    name: string;
    sha: string;
    type: string;
    size: number;
  }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: REPORTS_DIR,
      ref: STATE_BRANCH,
    });
    if (!Array.isArray(data)) return [];
    entries = data as Array<{
      name: string;
      sha: string;
      type: string;
      size: number;
    }>;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return [];
    throw error;
  }

  const slugs = entries
    .filter((e) => e.type === "file")
    .map((e) => ({ slug: slugFromName(e.name), name: e.name, size: e.size }))
    .filter(
      (e): e is { slug: string; name: string; size: number } => e.slug !== null,
    );

  const files = await Promise.all(
    slugs.map(async ({ slug, name, size }) => {
      try {
        const filePath = `${REPORTS_DIR}/${name}`;
        const { data } = await octokit.repos.getContent({
          owner: getOwner(),
          repo: getRepo(),
          path: filePath,
          ref: STATE_BRANCH,
        });
        if (Array.isArray(data) || !("content" in data) || !data.content)
          return null;
        const raw = Buffer.from(data.content, "base64").toString("utf-8");
        const parsed = parseReportMarkdown(raw, slug);
        const updatedAt = await fetchLastCommitDate(octokit, filePath);
        return {
          slug,
          title: parsed.title,
          body: parsed.body,
          updatedAt,
          htmlUrl: buildHtmlUrl(slug),
          size,
          dutySlug: parsed.dutySlug,
          reviewStatus: parsed.reviewStatus,
          reviewArea: parsed.reviewArea,
          findingCount: parsed.findingCount,
        } satisfies ReportFile;
      } catch {
        return null;
      }
    }),
  );

  // Most recently updated first — reports are time-sensitive health signals.
  return files
    .filter((f): f is ReportFile => f !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Read a single report by slug. Returns `null` if the file does not exist.
 */
export async function readReportFile(slug: string): Promise<ReportFile | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = getOctokit();
  const filePath = `${REPORTS_DIR}/${slug}.md`;

  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      ref: STATE_BRANCH,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    const parsed = parseReportMarkdown(raw, slug);
    const updatedAt = await fetchLastCommitDate(octokit, filePath);
    return {
      slug,
      title: parsed.title,
      body: parsed.body,
      updatedAt,
      htmlUrl: buildHtmlUrl(slug),
      size: typeof data.size === "number" ? data.size : raw.length,
      dutySlug: parsed.dutySlug,
      reviewStatus: parsed.reviewStatus,
      reviewArea: parsed.reviewArea,
      findingCount: parsed.findingCount,
    };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}
