/**
 * @fileType utility
 * @domain kody
 * @pattern instructions-files
 * @ai-summary Read/write the per-repo user instructions document
 *   stored at `.kody/instructions.md`. This is a single free-form
 *   markdown file (no frontmatter) appended to every kody-direct
 *   chat turn under "## User instructions for this repo" — the
 *   user's place to put tone, length, formatting, or behavioral
 *   preferences that override the base agent prompt. Voice overlay
 *   still wins over this block (applied after buildSystemPrompt
 *   in route.ts) so TTS output shape stays correct on the mic.
 *
 *   Cache mirrors the memory-index pattern: 60s in-process per
 *   repo, invalidated by the PUT/DELETE routes.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "../github-client";

const INSTRUCTIONS_PATH = ".kody/instructions.md";

export interface InstructionsFile {
  body: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

async function getDefaultBranch(octokit: Octokit): Promise<string> {
  const { data } = await octokit.repos.get({
    owner: getOwner(),
    repo: getRepo(),
  });
  return data.default_branch;
}

async function fetchLastCommitDate(octokit: Octokit): Promise<string> {
  try {
    const { data } = await octokit.repos.listCommits({
      owner: getOwner(),
      repo: getRepo(),
      path: INSTRUCTIONS_PATH,
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

function buildHtmlUrl(branch: string | null): string {
  const ref = branch ?? "HEAD";
  return `https://github.com/${getOwner()}/${getRepo()}/blob/${ref}/${INSTRUCTIONS_PATH}`;
}

export async function readInstructionsFile(): Promise<InstructionsFile | null> {
  const octokit = getOctokit();
  const branch = await getDefaultBranch(octokit).catch(() => null);
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: INSTRUCTIONS_PATH,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    const body = Buffer.from(data.content, "base64").toString("utf-8");
    const updatedAt = await fetchLastCommitDate(octokit);
    return {
      body,
      sha: data.sha,
      updatedAt,
      htmlUrl: buildHtmlUrl(branch),
    };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

interface WriteOptions {
  octokit: Octokit;
  body: string;
  sha?: string;
  message?: string;
}

export async function writeInstructionsFile(
  opts: WriteOptions,
): Promise<InstructionsFile> {
  const body = opts.body.endsWith("\n") ? opts.body : `${opts.body}\n`;
  const message =
    opts.message ??
    `${opts.sha ? "chore" : "feat"}(instructions): ${opts.sha ? "update" : "add"} chat instructions`;

  await opts.octokit.repos.createOrUpdateFileContents({
    owner: getOwner(),
    repo: getRepo(),
    path: INSTRUCTIONS_PATH,
    message,
    content: Buffer.from(body, "utf-8").toString("base64"),
    sha: opts.sha,
  });

  invalidateInstructionsPromptCache();
  const refreshed = await readInstructionsFile();
  if (!refreshed) {
    throw new Error(
      "writeInstructionsFile: file was written but could not be re-read",
    );
  }
  return refreshed;
}

export async function deleteInstructionsFile(octokit: Octokit): Promise<void> {
  const existing = await readInstructionsFile();
  if (!existing) return;
  await octokit.repos.deleteFile({
    owner: getOwner(),
    repo: getRepo(),
    path: INSTRUCTIONS_PATH,
    message: "chore(instructions): remove chat instructions",
    sha: existing.sha,
  });
  invalidateInstructionsPromptCache();
}

interface CachedInstructions {
  body: string;
  expiresAt: number;
}
const cache = new Map<string, CachedInstructions>();
const CACHE_TTL_MS = 60_000;

function cacheKey(): string {
  return `${getOwner()}/${getRepo()}`;
}

/**
 * Load the user instructions for the current request's repo with a 60-second
 * in-process cache (same TTL as the memory-index loader). Returns `null` when
 * the file is absent or empty — callers should treat that as "no overlay".
 */
export async function loadInstructionsForPrompt(): Promise<string | null> {
  const key = cacheKey();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.body || null;
  }
  const result = await readInstructionsFile();
  const body = (result?.body ?? "").trim();
  cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });
  return body || null;
}

export function invalidateInstructionsPromptCache(): void {
  cache.delete(cacheKey());
}

export { INSTRUCTIONS_PATH };
