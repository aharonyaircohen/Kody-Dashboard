/**
 * @fileType util
 * @domain kody
 * @pattern context-files
 * @ai-summary Read/write context-entry files under `.kody/context/<slug>.md`
 *   via the GitHub contents API. Multi-file like prompts: the slug is the
 *   entry name (e.g. `company-profile`, `mission`, `products`) and the body
 *   is free-form markdown — curated context you write FOR Kody (company
 *   facts, brand, persona briefs). Reference docs that already live in the
 *   repo (README, DESIGN_SYSTEM.md) belong in the repo, not here.
 *
 *   Each file may carry a tiny YAML frontmatter block with a single
 *   `staff:` field — an inline list (`[kody, qa-engineer]`) of the
 *   staff-member slugs that own the entry. Legacy files use `audience:` or
 *   have NO frontmatter; both are mapped on read (`chat` → `kody`,
 *   `qa` → `qa-engineer`, frontmatter-less → `[kody]`) so existing data
 *   keeps flowing unchanged (see `context/frontmatter.ts`).
 *
 *   Entries owned by the built-in chat staff (`kody`) are injected into the
 *   kody-direct chat system prompt under a `## Context` heading (see
 *   `loadContextForPrompt`), so every persona inherits the facts without
 *   restating them. Context entries are included in the Company bundle because
 *   duties and staff may depend on them.
 *
 *   Hot-path loader mirrors the instructions/memory-index pattern: a
 *   60s in-process per-repo cache, invalidated by the write/delete
 *   routes.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "../github-client";
import {
  splitContextFrontmatter,
  joinContextFrontmatter,
  KODY_CHAT_STAFF,
  ALL_STAFF,
} from "./frontmatter";

const CONTEXT_DIR = ".kody/context";

export interface ContextFile {
  /** Filename without `.md` — stable identity, also the entry heading. */
  slug: string;
  /**
   * Free-form markdown body. Frontmatter is stripped — this is the entry
   * text only.
   */
  body: string;
  /**
   * Staff-member slugs that own this entry, from `staff:` frontmatter.
   * Defaults to `["kody"]` (the built-in chat staff) for legacy
   * frontmatter-less files. Always non-empty unless explicitly unassigned.
   */
  staff: string[];
  /** Git blob sha. Required for update/delete. */
  sha: string;
  /** Last commit timestamp affecting this file. */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

function slugFromName(name: string): string | null {
  if (!name.endsWith(".md")) return null;
  const slug = name.slice(0, -".md".length);
  if (slug.length === 0 || slug.startsWith(".") || slug.startsWith("_"))
    return null;
  return slug;
}

function buildHtmlUrl(slug: string, branch: string | null): string {
  const ref = branch ?? "HEAD";
  return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${CONTEXT_DIR}/${slug}.md`;
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
 * List every context file under `.kody/context/`. Returns `[]` if the
 * directory does not exist. Sorted by slug for a stable UI order.
 */
export async function listContextFiles(): Promise<ContextFile[]> {
  const octokit = getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);

  let entries: Array<{ name: string; sha: string; type: string }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: CONTEXT_DIR,
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
      (e): e is { slug: string; sha: string; name: string } => e.slug !== null,
    );

  const files = await Promise.all(
    slugs.map(async ({ slug, sha, name }) => {
      try {
        const filePath = `${CONTEXT_DIR}/${name}`;
        const { data } = await octokit.repos.getContent({
          owner: getOwner(),
          repo: getRepo(),
          path: filePath,
        });
        if (Array.isArray(data) || !("content" in data) || !data.content)
          return null;
        const raw = Buffer.from(data.content, "base64")
          .toString("utf-8")
          .replace(/^\s+/, "");
        const { frontmatter, body } = splitContextFrontmatter(raw);
        const updatedAt = await fetchLastCommitDate(octokit, filePath);
        return {
          slug,
          body: body.replace(/^\s+/, ""),
          staff: frontmatter.staff,
          sha,
          updatedAt,
          htmlUrl: buildHtmlUrl(slug, branch),
        } satisfies ContextFile;
      } catch {
        return null;
      }
    }),
  );

  const nonNull: ContextFile[] = files.filter(
    (f): f is NonNullable<typeof f> => f !== null,
  );
  nonNull.sort((a, b) => a.slug.localeCompare(b.slug));
  return nonNull;
}

export async function readContextFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<ContextFile | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);
  const filePath = `${CONTEXT_DIR}/${slug}.md`;

  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    const raw = Buffer.from(data.content, "base64")
      .toString("utf-8")
      .replace(/^\s+/, "");
    const { frontmatter, body } = splitContextFrontmatter(raw);
    const updatedAt = await fetchLastCommitDate(octokit, filePath);
    return {
      slug,
      body: body.replace(/^\s+/, ""),
      staff: frontmatter.staff,
      sha: data.sha,
      updatedAt,
      htmlUrl: buildHtmlUrl(slug, branch),
    };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

interface WriteOptions {
  octokit: Octokit;
  slug: string;
  /** Entry markdown (frontmatter-free); the `staff:` block is re-attached here. */
  body: string;
  /** Owning staff-member slugs persisted in `staff:` frontmatter (inline list). */
  staff: string[];
  sha?: string;
  message?: string;
}

export async function writeContextFile(
  opts: WriteOptions,
): Promise<ContextFile> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(
      `Invalid context slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`,
    );
  }
  const filePath = `${CONTEXT_DIR}/${opts.slug}.md`;
  const withFrontmatter = joinContextFrontmatter(
    { staff: opts.staff },
    opts.body,
  );
  const content = withFrontmatter.endsWith("\n")
    ? withFrontmatter
    : `${withFrontmatter}\n`;
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(context): ${opts.sha ? "update" : "add"} ${opts.slug}`;

  await opts.octokit.repos.createOrUpdateFileContents({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    sha: opts.sha,
  });

  invalidateContextPromptCache();
  // Confirm with the same octokit that wrote — not the per-request global,
  // which a concurrent request may have cleared (→ 401 "Bad credentials").
  const refreshed = await readContextFile(opts.slug, opts.octokit);
  if (!refreshed) {
    throw new Error(
      "writeContextFile: file was written but could not be re-read",
    );
  }
  return refreshed;
}

export async function deleteContextFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid context slug: "${slug}".`);
  }
  const existing = await readContextFile(slug);
  if (!existing) return;
  const filePath = `${CONTEXT_DIR}/${slug}.md`;
  await octokit.repos.deleteFile({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message: `chore(context): remove ${slug}`,
    sha: existing.sha,
  });
  invalidateContextPromptCache();
}

// ─── Hot-path loader (chat system prompt) ──────────────────────────────────

interface CachedContext {
  prompt: string;
  expiresAt: number;
}
const cache = new Map<string, CachedContext>();
const CACHE_TTL_MS = 60_000;

function cacheKey(): string {
  return `${getOwner()}/${getRepo()}`;
}

/**
 * Concatenate the chat-staff context files into a single markdown block for
 * the chat system prompt, each entry prefixed with its slug as a `###`
 * heading. Only entries owned by the built-in chat staff (`kody`) or the `*`
 * all-staff wildcard are included — entries attached only to other staff
 * (e.g. `qa-engineer`) are skipped so they never reach the chat prompt.
 * Returns `null` when no such entries exist. 60s in-process cache (same TTL
 * as the instructions loader); callers treat `null` as "no context".
 */
export async function loadContextForPrompt(): Promise<string | null> {
  const key = cacheKey();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.prompt || null;
  }
  const files = await listContextFiles();
  const prompt = files
    .filter(
      (f) => f.staff.includes(KODY_CHAT_STAFF) || f.staff.includes(ALL_STAFF),
    )
    .map((f) => `### ${f.slug}\n\n${f.body.trim()}`)
    .join("\n\n")
    .trim();
  cache.set(key, { prompt, expiresAt: Date.now() + CACHE_TTL_MS });
  return prompt || null;
}

export function invalidateContextPromptCache(): void {
  cache.delete(cacheKey());
}

export { CONTEXT_DIR };
