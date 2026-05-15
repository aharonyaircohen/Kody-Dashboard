/**
 * @fileType utility
 * @domain engine
 * @pattern engine-config
 * @ai-summary Reads and caches the kody.config.json file from a consumer repo.
 */

import type { Octokit } from "@octokit/rest";

export const KODY_CONFIG_PATH = "kody.config.json";

export interface KodyConfig {
  model?: {
    default?: string;
  };
  executables: {
    default: string;
  };
}

/** Default config when no kody.config.json exists in the repo. */
export const defaultConfig: KodyConfig = {
  executables: {
    default: "run",
  },
};

interface CacheEntry {
  config: KodyConfig;
  sha: string | null;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<
  string,
  Promise<{ config: KodyConfig; sha: string | null }>
>();
const TTL_MS = 60_000;

function cacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

async function fetchConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ config: KodyConfig; sha: string | null }> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: KODY_CONFIG_PATH,
    });
    const data = res.data;
    if (Array.isArray(data) || !("content" in data) || !data.content) {
      return { config: defaultConfig, sha: null };
    }
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    const parsed = JSON.parse(content) as KodyConfig;
    return {
      config: {
        executables: parsed.executables ?? { default: "run" },
        model: parsed.model,
      },
      sha: data.sha ?? null,
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return { config: defaultConfig, sha: null };
    }
    throw err;
  }
}

/**
 * Read kody.config.json from the consumer repo. Results are cached for 60s.
 * Use `force: true` to bypass the cache.
 */
export async function getEngineConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: { force?: boolean } = {},
): Promise<{ config: KodyConfig; sha: string | null }> {
  const key = cacheKey(owner, repo);
  if (!options.force) {
    const cached = CACHE.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { config: cached.config, sha: cached.sha };
    }
  }

  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;

  const promise = fetchConfig(octokit, owner, repo)
    .then((result) => {
      CACHE.set(key, {
        config: result.config,
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

/** Invalidate the cached config for a repo (call after writes). */
export function invalidateEngineConfigCache(owner: string, repo: string): void {
  CACHE.delete(cacheKey(owner, repo));
}
