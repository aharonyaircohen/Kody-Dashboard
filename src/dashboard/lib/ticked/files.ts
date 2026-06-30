/**
 * @fileType util
 * @domain kody
 * @pattern ticked-files
 * @ai-summary Markdown-backed store for ticked-file shaped records.
 *   Agent identities use `<dir>/<slug>.md`; capabilities and goals have their
 *   own stores.
 *
 *   One file per definition. Path is the source of truth for identity
 *   (slug), file body is the markdown. Metadata (title, lastModified,
 *   sha) is derived from the file itself and the GitHub commit history
 *   is the audit trail — no labels, no issue tracker.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "../github-client";
import {
  deleteStateFile,
  listStateDirectory,
  readStateText,
  resolveStateRepo,
  stateRepoPath,
  writeStateText,
} from "../state-repo";
import {
  joinFrontmatter,
  splitFrontmatter,
  type TickFrontmatter,
} from "./frontmatter";

export interface TickFile {
  /** Stable identity slug. */
  slug: string;
  /** First H1 of the body, or humanized slug fallback. */
  title: string;
  /** Markdown body (post-H1 if present, else the entire file). */
  body: string;
  /** Git blob sha. Required for update/delete. Returned by reads only. */
  sha: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
  /** Runtime resolution source. Local repo assets win over store assets. */
  source?: "local" | "store";
  /** Store-linked assets are visible and runnable, but not editable locally. */
  readOnly?: boolean;
}

export interface TickWriteOptions {
  octokit: Octokit;
  slug: string;
  title: string;
  body: string;
  /** SHA of the existing blob; omit on create. */
  sha?: string;
  /** Commit message override. */
  message?: string;
}

/** Config that distinguishes one ticked-file kind (e.g. capabilities) from another. */
export interface TickedFilesConfig {
  /** Repo-relative directory holding markdown definitions. */
  dir: string;
  /** Conventional-commit scope used in generated commit messages. */
  commitScope: string;
  /** In-process cache invalidator for this kind. */
  invalidateCache: (slug?: string) => void;
}

export interface TickedFilesApi {
  listFiles(): Promise<TickFile[]>;
  readFile(slug: string, octokitOverride?: Octokit): Promise<TickFile | null>;
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
  // Strip *every* leading H1 block — past round-trips could have prepended
  // the title multiple times, and any surviving leading H1 renders as a
  // duplicate title in the body card.
  //
  // Critically, skip leading blank lines before each check: the body handed
  // to us starts with the blank line that follows the frontmatter `---`, so
  // a naive `lines[0]` test sees "" and strips nothing.
  const lines = body.replace(/^﻿/, "").split("\n");
  let i = 0;
  for (;;) {
    while (i < lines.length && lines[i]!.trim() === "") i++;
    if (i < lines.length && /^#\s+.+/.test(lines[i]!)) {
      i++;
    } else {
      break;
    }
  }
  return lines.slice(i).join("\n");
}

/**
 * Parse a raw ticked markdown file: split frontmatter, then derive title
 * and body from what remains. Title is the first H1 of the body or a
 * humanized slug; body is everything after the H1 (or the whole post-
 * frontmatter remainder).
 */
export function parseTickedMarkdown(
  raw: string,
  slug: string,
): { title: string; body: string; frontmatter: TickFrontmatter } {
  const { frontmatter, body: afterFm } = splitFrontmatter(raw);
  const body = stripLeadingH1(afterFm);
  const title = deriveTitle(afterFm, slug);
  return { title, body, frontmatter };
}

function stateDirPath(dir: string): string {
  return dir.replace(/^\.kody\/?/, "").replace(/\/+$/, "");
}

async function fetchStateLastCommitDate(
  octokit: Octokit,
  filePath: string,
): Promise<string | null> {
  try {
    const target = await resolveStateRepo(octokit, getOwner(), getRepo());
    const { data } = await octokit.repos.listCommits({
      owner: target.owner,
      repo: target.repo,
      path: stateRepoPath(target, filePath),
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

function buildFileContent(title: string, body: string): string {
  // Strip any leading H1 the caller's body already carries so we never
  // double the title — `# ${title}` is the single canonical heading.
  const trimmedBody = stripLeadingH1(body.replace(/^\s+/, ""));
  const titled =
    trimmedBody.length > 0
      ? `# ${title.trim()}\n\n${trimmedBody}${trimmedBody.endsWith("\n") ? "" : "\n"}`
      : `# ${title.trim()}\n`;
  return joinFrontmatter({}, titled);
}

/**
 * Bind a directory, commit scope, and cache invalidator to produce the
 * file API for one markdown-backed identity kind.
 */
export function createTickedFiles(config: TickedFilesConfig): TickedFilesApi {
  const { dir, commitScope, invalidateCache } = config;

  /**
   * List every file under `<dir>/`. Returns `[]` if the directory does
   * not exist (fresh repo).
   */
  async function listFiles(): Promise<TickFile[]> {
    const octokit = getOctokit();

    const { entries } = await listStateDirectory(
      octokit,
      getOwner(),
      getRepo(),
      stateDirPath(dir),
      { headers: { "If-None-Match": "" } },
    );

    const slugs = entries
      .filter((e) => e.type === "file")
      .map((e) => ({ slug: slugFromName(e.name), name: e.name }))
      .filter((e): e is { slug: string; name: string } => e.slug !== null);

    const files = await Promise.all(
      slugs.map(async ({ slug, name }): Promise<TickFile | null> => {
        try {
          const filePath = `${stateDirPath(dir)}/${name}`;
          const file = await readStateText(
            octokit,
            getOwner(),
            getRepo(),
            filePath,
            { headers: { "If-None-Match": "" } },
          );
          if (!file) return null;
          const raw = file.content;
          const { title, body } = parseTickedMarkdown(raw, slug);
          const updatedAt =
            (await fetchStateLastCommitDate(octokit, filePath)) ??
            new Date().toISOString();
          return {
            slug,
            title,
            body,
            sha: file.sha,
            updatedAt,
            htmlUrl: file.htmlUrl ?? "",
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
    const filePath = `${stateDirPath(dir)}/${slug}.md`;

    try {
      const file = await readStateText(
        octokit,
        getOwner(),
        getRepo(),
        filePath,
        { headers: { "If-None-Match": "" } },
      );
      if (!file) return null;
      const raw = file.content;
      const { title, body } = parseTickedMarkdown(raw, slug);
      const updatedAt =
        (await fetchStateLastCommitDate(octokit, filePath)) ??
        new Date().toISOString();
      return {
        slug,
        title,
        body,
        sha: file.sha,
        updatedAt,
        htmlUrl: file.htmlUrl ?? "",
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
    const filePath = `${stateDirPath(dir)}/${opts.slug}.md`;
    const content = buildFileContent(opts.title, opts.body);
    const message =
      opts.message ??
      `${opts.sha ? "chore" : "feat"}(${commitScope}): ${opts.sha ? "update" : "add"} ${opts.slug}`;

    await writeStateText({
      octokit: opts.octokit,
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
      message,
      content,
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
    const filePath = `${stateDirPath(dir)}/${slug}.md`;
    await deleteStateFile({
      octokit,
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
