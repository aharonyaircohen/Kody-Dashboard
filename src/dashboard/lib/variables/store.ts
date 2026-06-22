/**
 * @fileType utility
 * @domain variables
 * @pattern state-repo
 * @ai-summary Read/write repo plaintext variables in the configured external
 * state repo. Sensitive values still belong in the encrypted vault.
 */

import type { Octokit } from "@octokit/rest";

import { logger } from "@dashboard/lib/logger";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";

export const VARIABLES_PATH = "variables.json";

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

async function fetchRaw(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ doc: VariablesDocument; sha: string | null }> {
  const file = await readStateText(octokit, owner, repo, VARIABLES_PATH, {
    headers: { "If-None-Match": "" },
  });

  if (!file) return { doc: emptyDoc(), sha: null };

  const parsed = JSON.parse(file.content) as VariablesDocument;
  if (parsed.version !== 1 || typeof parsed.variables !== "object") {
    throw new Error("Variables document has unexpected shape");
  }

  return { doc: parsed, sha: file.sha };
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
  const { sha: newSha } = await writeStateText({
    octokit,
    owner,
    repo,
    path: VARIABLES_PATH,
    content: JSON.stringify(doc, null, 2),
    message: commitMessage,
    sha: currentSha ?? undefined,
  });

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
 * Read-modify-write helper with 409 (SHA conflict) retry. `mutate` is pure
 * and runs again on the latest document when there is a retry, so concurrent
 * writes to different keys do not clobber each other.
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
