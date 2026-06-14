/**
 * @fileType utility
 * @domain variables
 * @pattern github-contents
 * @ai-summary Read/write a per-repo plaintext variables file at
 *   .kody/variables.json. Mirrors the encrypted vault pattern (read-through
 *   cache, in-flight dedup, write-then-invalidate) but stores non-sensitive
 *   config that needs to be human-readable: model lists, model ids, feature
 *   flags. Sensitive values still belong in the encrypted vault.
 */

import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";

export const VARIABLES_PATH = ".kody/variables.json";

export interface VariableMeta {
  updatedAt: string;
  updatedBy?: string;
}

export interface VariableEntry extends VariableMeta {
  value: string;
}

export interface VariablesDocument {
  version: 1;
  variables: Record<string, VariableEntry>;
}

interface CacheEntry {
  doc: VariablesDocument;
  sha: string | null;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<
  string,
  Promise<{ doc: VariablesDocument; sha: string | null }>
>();
const TTL_MS = 60_000;

function cacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function emptyDoc(): VariablesDocument {
  return { version: 1, variables: {} };
}

interface RawContentsResponse {
  type?: string;
  encoding?: string;
  content?: string;
  sha?: string;
}

async function fetchRaw(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ doc: VariablesDocument; sha: string | null }> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: VARIABLES_PATH,
      headers: { "If-None-Match": "" },
    });
    const data = res.data as RawContentsResponse | RawContentsResponse[];
    if (Array.isArray(data) || data.type !== "file" || !data.content) {
      return { doc: emptyDoc(), sha: null };
    }
    const buf = Buffer.from(
      data.content,
      (data.encoding ?? "base64") as BufferEncoding,
    );
    const text = buf.toString("utf8").trim();
    const parsed = JSON.parse(text) as VariablesDocument;
    if (parsed.version !== 1 || typeof parsed.variables !== "object") {
      throw new Error("Variables document has unexpected shape");
    }
    return { doc: parsed, sha: data.sha ?? null };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return { doc: emptyDoc(), sha: null };
    }
    throw err;
  }
}

export async function readVariables(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: { force?: boolean } = {},
): Promise<{ doc: VariablesDocument; sha: string | null }> {
  const key = cacheKey(owner, repo);
  if (!options.force) {
    const cached = CACHE.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { doc: cached.doc, sha: cached.sha };
    }
  }

  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;

  const promise = fetchRaw(octokit, owner, repo)
    .then((result) => {
      CACHE.set(key, {
        doc: result.doc,
        sha: result.sha,
        expiresAt: Date.now() + TTL_MS,
      });
      return result;
    })
    .finally(() => {
      INFLIGHT.delete(key);
    });

  INFLIGHT.set(key, promise);
  return promise;
}

export async function writeVariables(
  octokit: Octokit,
  owner: string,
  repo: string,
  doc: VariablesDocument,
  currentSha: string | null,
  commitMessage = "chore(variables): update dashboard variables",
): Promise<{ sha: string }> {
  const content = Buffer.from(JSON.stringify(doc, null, 2), "utf8").toString(
    "base64",
  );
  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: VARIABLES_PATH,
    message: commitMessage,
    content,
    ...(currentSha ? { sha: currentSha } : {}),
  });
  const newSha = res.data.content?.sha ?? null;
  CACHE.set(cacheKey(owner, repo), {
    doc,
    sha: newSha,
    expiresAt: Date.now() + TTL_MS,
  });
  if (!newSha) {
    logger.warn(
      { owner, repo },
      "variables: GitHub returned no sha after write",
    );
    return { sha: "" };
  }
  return { sha: newSha };
}

export function invalidateVariablesCache(owner: string, repo: string): void {
  CACHE.delete(cacheKey(owner, repo));
}

/**
 * Read-modify-write helper with 409 (SHA conflict) retry. `mutate` is a pure
 * function returning the new document from the freshly-read one; it runs again
 * on each retry against the latest SHA, so concurrent writes to *different*
 * keys don't clobber each other. Mirrors the changelog store's
 * `updateChangelog`. Non-409 errors (and `mutate` throwing) propagate
 * immediately. Returns the written document.
 */
export async function updateVariables(
  octokit: Octokit,
  owner: string,
  repo: string,
  mutate: (doc: VariablesDocument) => VariablesDocument,
  commitMessage: string,
  maxAttempts = 3,
): Promise<{ doc: VariablesDocument }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { doc, sha } = await readVariables(octokit, owner, repo, {
      force: true,
    });
    const next = mutate(doc);
    try {
      await writeVariables(octokit, owner, repo, next, sha, commitMessage);
      invalidateVariablesCache(owner, repo);
      return { doc: next };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409 && attempt < maxAttempts) {
        invalidateVariablesCache(owner, repo);
        await new Promise((r) => setTimeout(r, 150 * attempt));
        continue;
      }
      throw err;
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new Error("variables: write failed after retries");
}

export function listVariables(doc: VariablesDocument): Array<{
  name: string;
  value: string;
  updatedAt: string;
  updatedBy?: string;
}> {
  return Object.entries(doc.variables)
    .map(([name, entry]) => ({
      name,
      value: entry.value,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
