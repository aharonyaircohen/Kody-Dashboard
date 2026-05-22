/**
 * @fileType util
 * @domain kody
 * @pattern ticked-files
 * @ai-summary One implementation of the "ticked markdown file" store —
 *   read/write `<dir>/<slug>.md` via the GitHub contents API. Duties and
 *   staff are the same mechanism (a markdown file the engine's
 *   job-tick chain enumerates and ticks); they differ only by directory,
 *   commit scope, and which cache to invalidate. `createTickedFiles`
 *   binds those three and returns the file API; `duties-files.ts` /
 *   `staff-files.ts` are thin presets over it.
 *
 *   One file per definition. Path is the source of truth for identity
 *   (slug), file body is the markdown. Metadata (title, lastModified,
 *   sha) is derived from the file itself and the GitHub commit history
 *   is the audit trail — no labels, no issue tracker.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "../github-client";
import {
  joinFrontmatter,
  splitFrontmatter,
  type TickFrontmatter,
  type ScheduleEvery,
} from "./frontmatter";

export interface TickFile {
  /** Filename without `.md` — stable identity. */
  slug: string;
  /** First H1 of the body, or humanized slug fallback. */
  title: string;
  /** Markdown body (post-H1 if present, else the entire file). */
  body: string;
  /** Git blob sha. Required for update/delete. Returned by reads only. */
  sha: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /**
   * Last commit timestamp of the sibling `<slug>.state.json` (ISO8601),
   * or `null` if the state file does not exist yet (never run). The
   * engine writes `<slug>.state.json` every tick that acts — see
   * `dispatchJobFileTicks` in kody2.
   */
  lastTickAt: string | null;
  /**
   * UTC ISO timestamp at which this file will next be eligible to act,
   * read from `data.nextEligibleISO` in the state JSON. Each body
   * instructs the agent to emit this on every tick. `null` when it has
   * never run, or its body doesn't yet emit the field.
   */
  nextEligibleAt: string | null;
  /**
   * Per-file cadence, parsed from the frontmatter `every:` field.
   * `null` means "every cron wake" (the engine's 15-minute cron).
   * Engine-side gating ships separately — the dashboard always shows
   * whatever the file declares.
   */
  schedule: ScheduleEvery | null;
  /**
   * Mirrors `disabled: true` in the frontmatter. When `true` the engine
   * skips this file on every cron wake; manual triggers still fire. The
   * dashboard reads this to render the enable/disable toggle and the
   * "disabled" pill in list rows.
   */
  disabled: boolean;
  /**
   * Assigned staff member (persona) slug from the `staff:` frontmatter, or
   * `null` if none. Duty-only in practice — staff are personas and never
   * declare a staff member. The dashboard reads this to render/seed the
   * duty's staff picker; the engine scheduler skips duties with no staff.
   */
  staff: string | null;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

export interface TickWriteOptions {
  octokit: Octokit;
  slug: string;
  title: string;
  body: string;
  /**
   * Per-file cadence to emit in frontmatter. `null` (or absent) writes
   * no `every:` line, leaving the file on the global cron tick.
   */
  schedule?: ScheduleEvery | null;
  /**
   * When `true`, emits `disabled: true` in frontmatter so the scheduler
   * skips this file on every cron wake. Absent or `false` keeps it active.
   */
  disabled?: boolean;
  /**
   * Staff member (persona) slug to emit as `staff:` frontmatter. `null`/absent
   * writes no `staff:` line. Only duties set this; staff files never do.
   */
  staff?: string | null;
  /** SHA of the existing blob; omit on create. */
  sha?: string;
  /** Commit message override. */
  message?: string;
}

/** Config that distinguishes one ticked-file kind (e.g. duties) from another. */
export interface TickedFilesConfig {
  /** Repo-relative directory holding the `.md` definitions. */
  dir: string;
  /** Conventional-commit scope used in generated commit messages. */
  commitScope: string;
  /** In-process cache invalidator for this kind. */
  invalidateCache: (slug?: string) => void;
}

export interface TickedFilesApi {
  listFiles(): Promise<TickFile[]>;
  readFile(slug: string): Promise<TickFile | null>;
  writeFile(opts: TickWriteOptions): Promise<TickFile>;
  deleteFile(octokit: Octokit, slug: string): Promise<void>;
  isValidSlug(slug: string): boolean;
}

function slugFromName(name: string): string | null {
  if (!name.endsWith(".md")) return null;
  const slug = name.slice(0, -".md".length);
  if (slug.length === 0 || slug.startsWith(".") || slug.startsWith("_"))
    return null;
  return slug;
}

function isValidSlug(slug: string): boolean {
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
  // The first H1 is the title (rendered separately in the detail header).
  // Strip *every* leading H1 block, not just one: past round-trips could
  // have prepended the title multiple times, and any surviving leading H1
  // would render as a duplicate title in the body card.
  let trimmed = body.replace(/^﻿/, "");
  for (;;) {
    const lines = trimmed.split("\n");
    if (lines.length > 0 && /^#\s+.+/.test(lines[0]!)) {
      trimmed = lines.slice(1).join("\n").replace(/^\n+/, "");
    } else {
      break;
    }
  }
  return trimmed;
}

/**
 * Parse a raw ticked markdown file: split frontmatter, then derive title
 * and body from what remains. Title is the first H1 of the body or a
 * humanized slug; body is everything after the H1 (or the whole post-
 * frontmatter remainder).
 */
function parseTickedMarkdown(
  raw: string,
  slug: string,
): { title: string; body: string; frontmatter: TickFrontmatter } {
  const { frontmatter, body: afterFm } = splitFrontmatter(raw);
  const body = stripLeadingH1(afterFm);
  const title = deriveTitle(afterFm, slug);
  return { title, body, frontmatter };
}

async function getDefaultBranch(octokit: Octokit): Promise<string> {
  const { data } = await octokit.repos.get({
    owner: getOwner(),
    repo: getRepo(),
  });
  return data.default_branch;
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
 * Like `fetchLastCommitDate` but returns `null` when the file has no
 * commits (i.e. it doesn't exist yet). Used for `<slug>.state.json`
 * which is created by the engine on first tick — absence means
 * "never ticked," not an error.
 */
async function fetchLastCommitDateOrNull(
  octokit: Octokit,
  filePath: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.listCommits({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      per_page: 1,
    });
    if (data.length === 0) return null;
    return (
      data[0]?.commit.committer?.date ?? data[0]?.commit.author?.date ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Fetch and parse `<slug>.state.json` to extract `data.nextEligibleISO` —
 * the ISO timestamp at which the file will next be eligible to act per
 * its cadence guard. The agent emits this field at the end of every
 * tick; see each definition's `## State` section. Missing file or
 * missing field → null.
 */
async function fetchNextEligibleAt(
  octokit: Octokit,
  dir: string,
  slug: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: `${dir}/${slug}.state.json`,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const inner = (parsed as { data?: unknown }).data;
    if (!inner || typeof inner !== "object") return null;
    const value = (inner as { nextEligibleISO?: unknown }).nextEligibleISO;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    return null;
  }
}

function buildFileContent(
  title: string,
  body: string,
  schedule: ScheduleEvery | null,
  disabled: boolean,
  staff: string | null,
): string {
  // Strip any leading H1 the caller's body already carries so we never
  // double the title — `# ${title}` is the single canonical heading.
  const trimmedBody = stripLeadingH1(body.replace(/^\s+/, ""));
  const titled =
    trimmedBody.length > 0
      ? `# ${title.trim()}\n\n${trimmedBody}${trimmedBody.endsWith("\n") ? "" : "\n"}`
      : `# ${title.trim()}\n`;
  const fm: TickFrontmatter = {};
  if (schedule) fm.every = schedule;
  if (staff) fm.staff = staff;
  if (disabled) fm.disabled = true;
  return joinFrontmatter(fm, titled);
}

/**
 * Bind a directory, commit scope, and cache invalidator to produce the
 * file API for one ticked-file kind. Duties and staff each call this
 * once with their own config.
 */
export function createTickedFiles(
  config: TickedFilesConfig,
): TickedFilesApi {
  const { dir, commitScope, invalidateCache } = config;

  function buildHtmlUrl(slug: string, branch: string | null): string {
    const ref = branch ?? "HEAD";
    return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${dir}/${slug}.md`;
  }

  /**
   * List every file under `<dir>/`. Returns `[]` if the directory does
   * not exist (fresh repo).
   */
  async function listFiles(): Promise<TickFile[]> {
    const octokit = getOctokit();
    const branch = await getDefaultBranch(octokit).catch(() => null);

    let entries: Array<{ name: string; sha: string; type: string }> = [];
    try {
      const { data } = await octokit.repos.getContent({
        owner: getOwner(),
        repo: getRepo(),
        path: dir,
      });
      if (!Array.isArray(data)) return [];
      entries = data as Array<{ name: string; sha: string; type: string }>;
    } catch (error: unknown) {
      if ((error as { status?: number })?.status === 404) return [];
      throw error;
    }

    const slugs = entries
      .filter((e) => e.type === "file")
      .map((e) => ({ slug: slugFromName(e.name), sha: e.sha, name: e.name }))
      .filter(
        (e): e is { slug: string; sha: string; name: string } =>
          e.slug !== null,
      );

    // Build a set of slugs that have a sibling `.state.json` so we only
    // pay for a commit-history fetch when the engine has actually ticked
    // the file at least once.
    const stateSlugs = new Set(
      entries
        .filter((e) => e.type === "file" && e.name.endsWith(".state.json"))
        .map((e) => e.name.slice(0, -".state.json".length))
        .filter((s) => s.length > 0),
    );

    const files = await Promise.all(
      slugs.map(async ({ slug, sha, name }) => {
        try {
          const filePath = `${dir}/${name}`;
          const { data } = await octokit.repos.getContent({
            owner: getOwner(),
            repo: getRepo(),
            path: filePath,
          });
          if (Array.isArray(data) || !("content" in data) || !data.content)
            return null;
          const raw = Buffer.from(data.content, "base64").toString("utf-8");
          const { title, body, frontmatter } = parseTickedMarkdown(raw, slug);
          const hasState = stateSlugs.has(slug);
          const [updatedAt, lastTickAt, nextEligibleAt] = await Promise.all([
            fetchLastCommitDate(octokit, filePath),
            hasState
              ? fetchLastCommitDateOrNull(
                  octokit,
                  `${dir}/${slug}.state.json`,
                )
              : Promise.resolve(null),
            hasState
              ? fetchNextEligibleAt(octokit, dir, slug)
              : Promise.resolve(null),
          ]);
          return {
            slug,
            title,
            body,
            sha,
            updatedAt,
            lastTickAt,
            nextEligibleAt,
            schedule: frontmatter.every ?? null,
            disabled: frontmatter.disabled === true,
            staff: frontmatter.staff ?? null,
            htmlUrl: buildHtmlUrl(slug, branch),
          } satisfies TickFile;
        } catch {
          return null;
        }
      }),
    );

    return files
      .filter((f): f is TickFile => f !== null)
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Read a single file by slug. Returns `null` if it does not exist.
   *
   * `octokitOverride` lets a caller (e.g. `writeFile`'s post-write confirm)
   * pin the read to a specific, known-good Octokit instead of the mutable
   * per-request global. This matters under concurrency: a parallel request's
   * `clearGitHubContext()` nulls the shared `_octokit`, after which
   * `getOctokit()` falls back to the env token and reads 401 ("Bad
   * credentials"). Passing the same octokit that performed the write keeps
   * the operation self-consistent.
   */
  async function readFile(
    slug: string,
    octokitOverride?: Octokit,
  ): Promise<TickFile | null> {
    if (!isValidSlug(slug)) return null;
    const octokit = octokitOverride ?? getOctokit();
    const branch = await getDefaultBranch(octokit).catch(() => null);
    const filePath = `${dir}/${slug}.md`;

    try {
      const { data } = await octokit.repos.getContent({
        owner: getOwner(),
        repo: getRepo(),
        path: filePath,
      });
      if (Array.isArray(data) || !("content" in data) || !data.content)
        return null;
      const raw = Buffer.from(data.content, "base64").toString("utf-8");
      const { title, body, frontmatter } = parseTickedMarkdown(raw, slug);
      const [updatedAt, lastTickAt, nextEligibleAt] = await Promise.all([
        fetchLastCommitDate(octokit, filePath),
        fetchLastCommitDateOrNull(octokit, `${dir}/${slug}.state.json`),
        fetchNextEligibleAt(octokit, dir, slug),
      ]);
      return {
        slug,
        title,
        body,
        sha: data.sha,
        updatedAt,
        lastTickAt,
        nextEligibleAt,
        schedule: frontmatter.every ?? null,
        disabled: frontmatter.disabled === true,
        staff: frontmatter.staff ?? null,
        htmlUrl: buildHtmlUrl(slug, branch),
      };
    } catch (error: unknown) {
      if ((error as { status?: number })?.status === 404) return null;
      throw error;
    }
  }

  /**
   * Create or update a file. Use `sha` for updates; omit for creates.
   * Returns the new TickFile record.
   */
  async function writeFile(opts: TickWriteOptions): Promise<TickFile> {
    if (!isValidSlug(opts.slug)) {
      throw new Error(
        `Invalid ${commitScope} slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`,
      );
    }
    const filePath = `${dir}/${opts.slug}.md`;
    const content = buildFileContent(
      opts.title,
      opts.body,
      opts.schedule ?? null,
      opts.disabled === true,
      opts.staff ?? null,
    );
    const message =
      opts.message ??
      `${opts.sha ? "chore" : "feat"}(${commitScope}): ${opts.sha ? "update" : "add"} ${opts.slug}`;

    await opts.octokit.repos.createOrUpdateFileContents({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha: opts.sha,
    });

    invalidateCache(opts.slug);
    // Confirm with the SAME octokit that performed the write — never the
    // per-request global, which a concurrent request may have cleared
    // (→ env-token fallback → 401 "Bad credentials" on an otherwise
    // successful write). See readFile's `octokitOverride`.
    const refreshed = await readFile(opts.slug, opts.octokit);
    if (!refreshed) {
      throw new Error(
        `writeFile: ${commitScope} file was written but could not be re-read`,
      );
    }
    return refreshed;
  }

  /**
   * Delete a file. Idempotent on already-missing files (no-op).
   */
  async function deleteFile(octokit: Octokit, slug: string): Promise<void> {
    if (!isValidSlug(slug)) {
      throw new Error(`Invalid ${commitScope} slug: "${slug}".`);
    }
    const existing = await readFile(slug);
    if (!existing) return;
    const filePath = `${dir}/${slug}.md`;
    await octokit.repos.deleteFile({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      message: `chore(${commitScope}): remove ${slug}`,
      sha: existing.sha,
    });
    invalidateCache(slug);
  }

  return { listFiles, readFile, writeFile, deleteFile, isValidSlug };
}
