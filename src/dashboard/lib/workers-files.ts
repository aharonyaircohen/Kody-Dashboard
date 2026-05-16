/**
 * Worker file storage — read/write `.kody/workers/<slug>.md` via the
 * GitHub contents API. Duplicated from jobs-files.ts.
 *
 * One file per worker. Path is the source of truth for identity (slug),
 * file body is the worker's markdown. Metadata (title, lastModified, sha)
 * is derived from the file itself and the GitHub commit history is the audit
 * trail — no labels, no issue tracker.
 */

import type { Octokit } from "@octokit/rest";
import {
  getOctokit,
  getOwner,
  getRepo,
  invalidateWorkersCache,
} from "./github-client";
import {
  joinFrontmatter,
  splitFrontmatter,
  type WorkerFrontmatter,
  type ScheduleEvery,
} from "./workers-frontmatter";

export interface WorkerFile {
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
   * or `null` if the state file does not exist yet (worker has never run).
   * The engine writes `<slug>.state.json` every tick that acts.
   */
  lastTickAt: string | null;
  /**
   * UTC ISO timestamp at which this worker will next be eligible to act,
   * read from `data.nextEligibleISO` in the state JSON. Each worker's body
   * instructs the agent to emit this on every tick. `null` when the
   * worker has never run, or its body doesn't yet emit the field.
   */
  nextEligibleAt: string | null;
  /**
   * Per-worker cadence, parsed from the frontmatter `every:` field.
   * `null` means "every cron wake" (the engine's 15-minute cron).
   * Engine-side gating ships separately — the dashboard always shows
   * whatever the file declares.
   */
  schedule: ScheduleEvery | null;
  /**
   * Mirrors `disabled: true` in the frontmatter. When `true` the engine
   * skips this worker on every cron wake; manual triggers still fire. The
   * dashboard reads this to render the enable/disable toggle and the
   * "disabled" pill in list rows.
   */
  disabled: boolean;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

const WORKERS_DIR = ".kody/workers";

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
  const trimmed = body.replace(/^﻿/, "");
  const lines = trimmed.split("\n");
  if (lines.length > 0 && /^#\s+.+/.test(lines[0]!)) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return trimmed;
}

/**
 * Parse a raw worker markdown file: split frontmatter, then derive title
 * and body from what remains. Title is the first H1 of the body or a
 * humanized slug; body is everything after the H1 (or the whole post-
 * frontmatter remainder).
 */
function parseWorkerMarkdown(
  raw: string,
  slug: string,
): { title: string; body: string; frontmatter: WorkerFrontmatter } {
  const { frontmatter, body: afterFm } = splitFrontmatter(raw);
  const body = stripLeadingH1(afterFm);
  const title = deriveTitle(afterFm, slug);
  return { title, body, frontmatter };
}

function buildHtmlUrl(slug: string, branch: string | null): string {
  const ref = branch ?? "HEAD";
  return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${WORKERS_DIR}/${slug}.md`;
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
 * the ISO timestamp at which the worker will next be eligible to act per its
 * cadence guard. The agent emits this field at the end of every tick;
 * see each worker's `## State` section. Missing file or missing field → null.
 */
async function fetchNextEligibleAt(
  octokit: Octokit,
  slug: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: `${WORKERS_DIR}/${slug}.state.json`,
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

/**
 * List every worker file under `.kody/workers/`. Returns `[]` if the
 * directory does not exist (fresh repo).
 */
export async function listWorkerFiles(): Promise<WorkerFile[]> {
  const octokit = getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);

  let entries: Array<{ name: string; sha: string; type: string }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: WORKERS_DIR,
    });
    if (!Array.isArray(data)) return [];
    entries = data as Array<{ name: string; sha: string; type: string }>;
  } catch (error: any) {
    if (error?.status === 404) return [];
    throw error;
  }

  const slugs = entries
    .filter((e) => e.type === "file")
    .map((e) => ({ slug: slugFromName(e.name), sha: e.sha, name: e.name }))
    .filter(
      (e): e is { slug: string; sha: string; name: string } => e.slug !== null,
    );

  // Build a set of slugs that have a sibling `.state.json` so we only
  // pay for a commit-history fetch when the engine has actually ticked
  // the worker at least once.
  const stateSlugs = new Set(
    entries
      .filter((e) => e.type === "file" && e.name.endsWith(".state.json"))
      .map((e) => e.name.slice(0, -".state.json".length))
      .filter((s) => s.length > 0),
  );

  const files = await Promise.all(
    slugs.map(async ({ slug, sha, name }) => {
      try {
        const filePath = `${WORKERS_DIR}/${name}`;
        const { data } = await octokit.repos.getContent({
          owner: getOwner(),
          repo: getRepo(),
          path: filePath,
        });
        if (Array.isArray(data) || !("content" in data) || !data.content)
          return null;
        const raw = Buffer.from(data.content, "base64").toString("utf-8");
        const { title, body, frontmatter } = parseWorkerMarkdown(raw, slug);
        const hasState = stateSlugs.has(slug);
        const [updatedAt, lastTickAt, nextEligibleAt] = await Promise.all([
          fetchLastCommitDate(octokit, filePath),
          hasState
            ? fetchLastCommitDateOrNull(
                octokit,
                `${WORKERS_DIR}/${slug}.state.json`,
              )
            : Promise.resolve(null),
          hasState ? fetchNextEligibleAt(octokit, slug) : Promise.resolve(null),
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
          htmlUrl: buildHtmlUrl(slug, branch),
        } satisfies WorkerFile;
      } catch {
        return null;
      }
    }),
  );

  return files
    .filter((f): f is WorkerFile => f !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Read a single worker file by slug. Returns `null` if the file does not
 * exist.
 */
export async function readWorkerFile(slug: string): Promise<WorkerFile | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);
  const filePath = `${WORKERS_DIR}/${slug}.md`;

  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    const { title, body, frontmatter } = parseWorkerMarkdown(raw, slug);
    const [updatedAt, lastTickAt, nextEligibleAt] = await Promise.all([
      fetchLastCommitDate(octokit, filePath),
      fetchLastCommitDateOrNull(octokit, `${WORKERS_DIR}/${slug}.state.json`),
      fetchNextEligibleAt(octokit, slug),
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
      htmlUrl: buildHtmlUrl(slug, branch),
    };
  } catch (error: any) {
    if (error?.status === 404) return null;
    throw error;
  }
}

interface WriteOptions {
  octokit: Octokit;
  slug: string;
  title: string;
  body: string;
  /**
   * Per-worker cadence to emit in frontmatter. `null` (or absent) writes
   * no `every:` line, leaving the worker on the global cron tick.
   */
  schedule?: ScheduleEvery | null;
  /**
   * When `true`, emits `disabled: true` in frontmatter so the scheduler
   * skips this worker on every cron wake. Absent or `false` keeps the
   * worker active.
   */
  disabled?: boolean;
  /** SHA of the existing blob; omit on create. */
  sha?: string;
  /** Commit message override. */
  message?: string;
}

function buildFileContent(
  title: string,
  body: string,
  schedule: ScheduleEvery | null,
  disabled: boolean,
): string {
  const trimmedBody = body.replace(/^\s+/, "");
  const titled = `# ${title.trim()}\n\n${trimmedBody}${trimmedBody.endsWith("\n") ? "" : "\n"}`;
  const fm: WorkerFrontmatter = {};
  if (schedule) fm.every = schedule;
  if (disabled) fm.disabled = true;
  return joinFrontmatter(fm, titled);
}

/**
 * Create or update a worker file. Use `sha` for updates; omit for creates.
 * Returns the new file's WorkerFile record.
 */
export async function writeWorkerFile(opts: WriteOptions): Promise<WorkerFile> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(
      `Invalid worker slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`,
    );
  }
  const filePath = `${WORKERS_DIR}/${opts.slug}.md`;
  const content = buildFileContent(
    opts.title,
    opts.body,
    opts.schedule ?? null,
    opts.disabled === true,
  );
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(workers): ${opts.sha ? "update" : "add"} ${opts.slug}`;

  await opts.octokit.repos.createOrUpdateFileContents({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    sha: opts.sha,
  });

  invalidateWorkersCache(opts.slug);
  const refreshed = await readWorkerFile(opts.slug);
  if (!refreshed) {
    throw new Error(
      "writeWorkerFile: file was written but could not be re-read",
    );
  }
  return refreshed;
}

/**
 * Delete a worker file. Idempotent on already-missing files (no-op).
 */
export async function deleteWorkerFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid worker slug: "${slug}".`);
  }
  const existing = await readWorkerFile(slug);
  if (!existing) return;
  const filePath = `${WORKERS_DIR}/${slug}.md`;
  await octokit.repos.deleteFile({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message: `chore(workers): remove ${slug}`,
    sha: existing.sha,
  });
  invalidateWorkersCache(slug);
}

export { isValidSlug };
