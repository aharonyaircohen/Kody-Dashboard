/**
 * @fileType util
 * @domain kody
 * @pattern doc-files
 * @ai-summary Read/write documentation files under `.kody/docs/<slug>.md`
 *   via the GitHub contents API. Multi-file like prompts: the slug is the
 *   doc name (e.g. `mission`, `products`, `customers`) and the body is
 *   free-form markdown — company facts, guidelines, a persona playbook, etc.
 *
 *   Each file may carry a tiny YAML frontmatter block with a single
 *   `staff:` field — an inline list (`[kody, qa-engineer]`) of the
 *   staff-member slugs that own the doc. Legacy files use `audience:` or
 *   have NO frontmatter; both are mapped on read (`chat` → `kody`,
 *   `qa` → `qa-engineer`, frontmatter-less → `[kody]`) so existing data
 *   keeps flowing unchanged (see `docs/frontmatter.ts`).
 *
 *   Docs owned by the built-in chat staff (`kody`) are injected into the
 *   kody-direct chat system prompt under a `## Documentation` heading (see
 *   `loadDocsForPrompt`), so every persona inherits the facts without
 *   restating them. Deliberately NOT part of the Company export/import
 *   bundle (that decision is still open).
 *
 *   Hot-path loader mirrors the instructions/memory-index pattern: a
 *   60s in-process per-repo cache, invalidated by the write/delete
 *   routes.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "../github-client";
import {
  splitDocFrontmatter,
  joinDocFrontmatter,
  KODY_CHAT_STAFF,
  ALL_STAFF,
} from "./frontmatter";

const DOCS_DIR = ".kody/docs";

export interface DocFile {
  /** Filename without `.md` — stable identity, also the doc heading. */
  slug: string;
  /**
   * Free-form markdown body. Frontmatter is stripped — this is the doc
   * text only.
   */
  body: string;
  /**
   * Staff-member slugs that own this doc, from `staff:` frontmatter.
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
  return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${DOCS_DIR}/${slug}.md`;
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
 * List every doc file under `.kody/docs/`. Returns `[]` if the directory
 * does not exist. Sorted by slug for a stable UI order.
 */
export async function listDocFiles(): Promise<DocFile[]> {
  const octokit = getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);

  let entries: Array<{ name: string; sha: string; type: string }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: DOCS_DIR,
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
        const filePath = `${DOCS_DIR}/${name}`;
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
        const { frontmatter, body } = splitDocFrontmatter(raw);
        const updatedAt = await fetchLastCommitDate(octokit, filePath);
        return {
          slug,
          body: body.replace(/^\s+/, ""),
          staff: frontmatter.staff,
          sha,
          updatedAt,
          htmlUrl: buildHtmlUrl(slug, branch),
        } satisfies DocFile;
      } catch {
        return null;
      }
    }),
  );

  const nonNull: DocFile[] = files.filter(
    (f): f is NonNullable<typeof f> => f !== null,
  );
  nonNull.sort((a, b) => a.slug.localeCompare(b.slug));
  return nonNull;
}

export async function readDocFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<DocFile | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);
  const filePath = `${DOCS_DIR}/${slug}.md`;

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
    const { frontmatter, body } = splitDocFrontmatter(raw);
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
  /** Doc markdown (frontmatter-free); the `staff:` block is re-attached here. */
  body: string;
  /** Owning staff-member slugs persisted in `staff:` frontmatter (inline list). */
  staff: string[];
  sha?: string;
  message?: string;
}

export async function writeDocFile(opts: WriteOptions): Promise<DocFile> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(
      `Invalid doc slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`,
    );
  }
  const filePath = `${DOCS_DIR}/${opts.slug}.md`;
  const withFrontmatter = joinDocFrontmatter({ staff: opts.staff }, opts.body);
  const content = withFrontmatter.endsWith("\n")
    ? withFrontmatter
    : `${withFrontmatter}\n`;
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(docs): ${opts.sha ? "update" : "add"} ${opts.slug}`;

  await opts.octokit.repos.createOrUpdateFileContents({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    sha: opts.sha,
  });

  invalidateDocsPromptCache();
  // Confirm with the same octokit that wrote — not the per-request global,
  // which a concurrent request may have cleared (→ 401 "Bad credentials").
  const refreshed = await readDocFile(opts.slug, opts.octokit);
  if (!refreshed) {
    throw new Error("writeDocFile: file was written but could not be re-read");
  }
  return refreshed;
}

export async function deleteDocFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid doc slug: "${slug}".`);
  }
  const existing = await readDocFile(slug);
  if (!existing) return;
  const filePath = `${DOCS_DIR}/${slug}.md`;
  await octokit.repos.deleteFile({
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message: `chore(docs): remove ${slug}`,
    sha: existing.sha,
  });
  invalidateDocsPromptCache();
}

// ─── Hot-path loader (chat system prompt) ──────────────────────────────────

interface CachedDocs {
  prompt: string;
  expiresAt: number;
}
const cache = new Map<string, CachedDocs>();
const CACHE_TTL_MS = 60_000;

function cacheKey(): string {
  return `${getOwner()}/${getRepo()}`;
}

/**
 * Concatenate the chat-staff doc files into a single markdown block for the
 * chat system prompt, each doc prefixed with its slug as a `###` heading.
 * Only docs owned by the built-in chat staff (`kody`) or the `*` all-staff
 * wildcard are included — docs attached only to other staff (e.g.
 * `qa-engineer`) are skipped so they never reach the chat prompt. Returns
 * `null` when no such docs exist. 60s in-process cache (same TTL as the
 * instructions loader); callers treat `null` as "no docs".
 */
export async function loadDocsForPrompt(): Promise<string | null> {
  const key = cacheKey();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.prompt || null;
  }
  const files = await listDocFiles();
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

export function invalidateDocsPromptCache(): void {
  cache.delete(cacheKey());
}

export { DOCS_DIR };
