/**
 * @fileType util
 * @domain kody
 * @pattern context-files
 * @ai-summary Read/write context-entry files under `context/<slug>.md`
 *   in the configured Kody state repo. Multi-file like prompts: the slug is the
 *   entry name (e.g. `company-profile`, `mission`, `products`) and the body
 *   is free-form markdown — curated context you write FOR Kody (company
 *   facts, brand, agentIdentity briefs). Reference docs that already live in the
 *   repo (README, DESIGN_SYSTEM.md) belong in the repo, not here.
 *
 *   Each file may carry a tiny YAML frontmatter block with a single
 *   `agent:` field — an inline list (`[kody, qa-engineer]`) of the
 *   agent-member slugs that own the entry. Legacy files use `audience:` or
 *   have NO frontmatter; both are mapped on read (`chat` → `kody`,
 *   `qa` → `qa-engineer`, frontmatter-less → `[kody]`) so existing data
 *   keeps flowing unchanged (see `context/frontmatter.ts`).
 *
 *   Entries owned by the built-in chat agent (`kody`) are injected into the
 *   kody-direct chat system prompt under a `## Context` heading (see
 *   `loadContextForPrompt`), so every agentIdentity inherits the facts without
 *   restating them. Context entries are included in the Company bundle because
 *   capabilities and agent may depend on them.
 *
 *   Hot-path loader mirrors the instructions/memory-index pattern: a
 *   60s in-process per-repo cache, invalidated by the write/delete
 *   routes.
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
  splitContextFrontmatter,
  joinContextFrontmatter,
  KODY_CHAT_AGENT,
  ALL_AGENT,
} from "./frontmatter";

const CONTEXT_DIR = "context";

export interface ContextFile {
  /** Filename without `.md` — stable identity, also the entry heading. */
  slug: string;
  /**
   * Free-form markdown body. Frontmatter is stripped — this is the entry
   * text only.
   */
  body: string;
  /**
   * Agent-member slugs that own this entry, from `agent:` frontmatter.
   * Defaults to `["kody"]` (the built-in chat agent) for legacy
   * frontmatter-less files. Always non-empty unless explicitly unassigned.
   */
  agent: string[];
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

async function fetchLastCommitDate(
  octokit: Octokit,
  filePath: string,
): Promise<string> {
  try {
    const target = await resolveStateRepo(octokit, getOwner(), getRepo());
    const { data } = await octokit.repos.listCommits({
      owner: target.owner,
      repo: target.repo,
      path: stateRepoPath(target, filePath),
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
 * List every context file under `context/` in the state repo. Returns `[]` if the
 * directory does not exist. Sorted by slug for a stable UI order.
 */
export async function listContextFiles(): Promise<ContextFile[]> {
  const octokit = getOctokit();
  const { entries } = await listStateDirectory(
    octokit,
    getOwner(),
    getRepo(),
    CONTEXT_DIR,
    { headers: { "If-None-Match": "" } },
  );

  const slugs = entries
    .filter((e) => e.type === "file")
    .map((e) => ({ slug: slugFromName(e.name), name: e.name }))
    .filter(
      (e): e is { slug: string; name: string } =>
        e.slug !== null && isValidSlug(e.slug),
    );

  const files = await Promise.all(
    slugs.map(async ({ slug, name }): Promise<ContextFile | null> => {
      try {
        const filePath = `${CONTEXT_DIR}/${name}`;
        const file = await readStateText(
          octokit,
          getOwner(),
          getRepo(),
          filePath,
          { headers: { "If-None-Match": "" } },
        );
        if (!file) return null;
        const raw = file.content.replace(/^\s+/, "");
        const { frontmatter, body } = splitContextFrontmatter(raw);
        const updatedAt = await fetchLastCommitDate(octokit, filePath);
        return {
          slug,
          body: body.replace(/^\s+/, ""),
          agent: frontmatter.agent,
          sha: file.sha,
          updatedAt,
          htmlUrl: file.htmlUrl ?? "",
        } satisfies ContextFile;
      } catch {
        return null;
      }
    }),
  );
  return files
    .filter((f): f is ContextFile => f !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
export async function readContextFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<ContextFile | null> {
  if (!isValidSlug(slug)) return null;
  const octokit = octokitOverride ?? getOctokit();
  const filePath = `${CONTEXT_DIR}/${slug}.md`;
  try {
    const file = await readStateText(octokit, getOwner(), getRepo(), filePath, {
      headers: { "If-None-Match": "" },
    });
    if (!file) return null;
    const raw = file.content.replace(/^\s+/, "");
    const { frontmatter, body } = splitContextFrontmatter(raw);
    const updatedAt = await fetchLastCommitDate(octokit, filePath);
    return {
      slug,
      body: body.replace(/^\s+/, ""),
      agent: frontmatter.agent,
      sha: file.sha,
      updatedAt,
      htmlUrl: file.htmlUrl ?? "",
    };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}
interface WriteOptions {
  octokit: Octokit;
  slug: string;
  /** Entry markdown (frontmatter-free); the `agent:` block is re-attached here. */
  body: string;
  /** Owning agent-member slugs persisted in `agent:` frontmatter (inline list). */
  agent: string[];
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
    { agent: opts.agent },
    opts.body,
  );
  const content = withFrontmatter.endsWith("\n")
    ? withFrontmatter
    : `${withFrontmatter}\n`;
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(context): ${opts.sha ? "update" : "add"} ${opts.slug}`;

  await writeStateText({
    octokit: opts.octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message,
    content,
    sha: opts.sha,
  });
  invalidateContextPromptCache();

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
  if (!isValidSlug(slug)) throw new Error(`Invalid context slug: "${slug}".`);
  const existing = await readContextFile(slug);
  if (!existing) return;
  await deleteStateFile({
    octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: `${CONTEXT_DIR}/${slug}.md`,
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
 * Concatenate the chat-agent context files into a single markdown block for
 * the chat system prompt, each entry prefixed with its slug as a `###`
 * heading. Only entries owned by the built-in chat agent (`kody`) or the `*`
 * all-agent wildcard are included — entries attached only to other agent
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
      (f) => f.agent.includes(KODY_CHAT_AGENT) || f.agent.includes(ALL_AGENT),
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
