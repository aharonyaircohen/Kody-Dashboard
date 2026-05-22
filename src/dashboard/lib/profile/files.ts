/**
 * @fileType util
 * @domain kody
 * @pattern profile-files
 * @ai-summary Read/write company-profile files under
 *   `.kody/profile/<slug>.md` via the GitHub contents API. Multi-file
 *   like prompts, but each file is plain free-form markdown with NO
 *   frontmatter (like `instructions.md`) — the slug is the section name
 *   (e.g. `mission`, `products`, `customers`) and the body is factual
 *   context describing the company.
 *
 *   The concatenated bodies are injected into the kody-direct chat
 *   system prompt under a `## Company profile` heading (see
 *   `loadProfileForPrompt`), so every persona inherits company facts
 *   without restating them. Deliberately NOT part of the Company
 *   export/import bundle (that decision is still open).
 *
 *   Hot-path loader mirrors the instructions/memory-index pattern: a
 *   60s in-process per-repo cache, invalidated by the write/delete
 *   routes.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "../github-client";

const PROFILE_DIR = ".kody/profile";

export interface ProfileFile {
  /** Filename without `.md` — stable identity, also the section heading. */
  slug: string;
  /** Free-form markdown body describing this slice of the company. */
  body: string;
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
  return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${PROFILE_DIR}/${slug}.md`;
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
 * List every profile file under `.kody/profile/`. Returns `[]` if the
 * directory does not exist. Sorted by slug for a stable UI order.
 */
export async function listProfileFiles(): Promise<ProfileFile[]> {
  const octokit = getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);

  let entries: Array<{ name: string; sha: string; type: string }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: PROFILE_DIR,
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
        const filePath = `${PROFILE_DIR}/${name}`;
        const { data } = await octokit.repos.getContent({
          owner: getOwner(),
          repo: getRepo(),
          path: filePath,
        });
        if (Array.isArray(data) || !("content" in data) || !data.content)
          return null;
        const body = Buffer.from(data.content, "base64")
          .toString("utf-8")
          .replace(/^\s+/, "");
        const updatedAt = await fetchLastCommitDate(octokit, filePath);
        return {
          slug,
          body,
          sha,
          updatedAt,
          htmlUrl: buildHtmlUrl(slug, branch),
        } satisfies ProfileFile;
      } catch {
        return null;
      }
    }),
  );

  const nonNull: ProfileFile[] = files.filter(
    (f): f is NonNullable<typeof f> => f !== null,
  );
  nonNull.sort((a, b) => a.slug.localeCompare(b.slug));
  return nonNull;
}

export async function readProfileFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<ProfileFile | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);
  const filePath = `${PROFILE_DIR}/${slug}.md`;

  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: filePath,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    const body = Buffer.from(data.content, "base64")
      .toString("utf-8")
      .replace(/^\s+/, "");
    const updatedAt = await fetchLastCommitDate(octokit, filePath);
    return {
      slug,
      body,
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
  body: string;
  sha?: string;
  message?: string;
}

export async function writeProfileFile(
  opts: WriteOptions,
): Promise<ProfileFile> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(
      `Invalid profile slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`,
    );
  }
  const filePath = `${PROFILE_DIR}/${opts.slug}.md`;
  const trimmed = opts.body.trimStart();
  const content = trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(profile): ${opts.sha ? "update" : "add"} ${opts.slug}`;

  await opts.octokit.repos.createOrUpdateFileContents({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    sha: opts.sha,
  });

  invalidateProfilePromptCache();
  // Confirm with the same octokit that wrote — not the per-request global,
  // which a concurrent request may have cleared (→ 401 "Bad credentials").
  const refreshed = await readProfileFile(opts.slug, opts.octokit);
  if (!refreshed) {
    throw new Error(
      "writeProfileFile: file was written but could not be re-read",
    );
  }
  return refreshed;
}

export async function deleteProfileFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid profile slug: "${slug}".`);
  }
  const existing = await readProfileFile(slug);
  if (!existing) return;
  const filePath = `${PROFILE_DIR}/${slug}.md`;
  await octokit.repos.deleteFile({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message: `chore(profile): remove ${slug}`,
    sha: existing.sha,
  });
  invalidateProfilePromptCache();
}

// ─── Hot-path loader (chat system prompt) ──────────────────────────────────

interface CachedProfile {
  prompt: string;
  expiresAt: number;
}
const cache = new Map<string, CachedProfile>();
const CACHE_TTL_MS = 60_000;

function cacheKey(): string {
  return `${getOwner()}/${getRepo()}`;
}

/**
 * Concatenate every profile file into a single markdown block for the
 * chat system prompt, each section prefixed with its slug as a `###`
 * heading. Returns `null` when the repo has no profile files. 60s
 * in-process cache (same TTL as the instructions loader); callers treat
 * `null` as "no profile".
 */
export async function loadProfileForPrompt(): Promise<string | null> {
  const key = cacheKey();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.prompt || null;
  }
  const files = await listProfileFiles();
  const prompt = files
    .map((f) => `### ${f.slug}\n\n${f.body.trim()}`)
    .join("\n\n")
    .trim();
  cache.set(key, { prompt, expiresAt: Date.now() + CACHE_TTL_MS });
  return prompt || null;
}

export function invalidateProfilePromptCache(): void {
  cache.delete(cacheKey());
}

export { PROFILE_DIR };
