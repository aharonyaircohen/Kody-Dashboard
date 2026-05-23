/**
 * @fileType utility
 * @domain engine
 * @pattern engine-config
 * @ai-summary Reads and caches the kody.config.json file from a consumer repo.
 */

import type { Octokit } from "@octokit/rest";

export const KODY_CONFIG_PATH = "kody.config.json";

export interface KodyConfig {
  /** The model the engine runs, as `provider/model`. This is the key the
   * kody-engine actually reads (`parseProviderModel(cfg.agent.model)`). */
  agent?: {
    model?: string;
  };
  executables: {
    default: string;
  };
  /** Engine repo context plus the operator list. `operators` is the set of
   * GitHub logins that recommendation duties (pr-health/CTO) @-mention so the
   * comment routes into their dashboard inbox. Empty/absent = nobody is
   * tagged, so recommendations post but reach no inbox. */
  github?: {
    owner?: string;
    repo?: string;
    operators?: string[];
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
        agent: parsed.agent,
        github: parsed.github,
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

/**
 * Set `agent.model` in the consumer repo's kody.config.json, preserving every
 * other field. This is the ONLY key the engine reads for its model
 * (`parseProviderModel(cfg.agent.model)`), so writing anything else is a no-op
 * from the engine's perspective.
 *
 * Merge-not-overwrite is load-bearing: the engine also requires `github.owner`
 * / `github.repo` and reads `quality`, `issueContext`, etc. A blind overwrite
 * would wipe them and break `loadConfig`. When the file doesn't exist yet we
 * seed the minimum the engine needs (`github`, `executables`, `agent.model`).
 *
 * Drops the legacy top-level `model` key the dashboard used to write — it was
 * never read by the engine.
 */
export async function writeEngineModel(
  octokit: Octokit,
  owner: string,
  repo: string,
  modelSpec: string | null,
  commitMessage?: string,
): Promise<{ sha: string | null }> {
  let existing: Record<string, unknown> = {};
  let existingSha: string | null = null;
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: KODY_CONFIG_PATH,
    });
    const data = res.data;
    if (!Array.isArray(data) && "content" in data && data.content) {
      existingSha = data.sha ?? null;
      try {
        existing = JSON.parse(
          Buffer.from(data.content, "base64").toString("utf-8"),
        ) as Record<string, unknown>;
      } catch {
        // Corrupt JSON — start clean rather than propagate a parse error,
        // but keep the sha so we replace (not 409) the bad file.
        existing = {};
      }
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err;
  }

  const prevAgent =
    typeof existing.agent === "object" && existing.agent !== null
      ? (existing.agent as Record<string, unknown>)
      : {};
  // Set agent.model when we have a spec; otherwise preserve whatever the
  // repo already had (so a no-model install still leaves a valid baseline).
  const agent = modelSpec ? { ...prevAgent, model: modelSpec } : prevAgent;

  const next: Record<string, unknown> = {
    ...existing,
    executables: existing.executables ?? { default: "run" },
    github: existing.github ?? { owner, repo },
  };
  if (Object.keys(agent).length > 0) next.agent = agent;
  delete next.model; // strip the legacy key the engine never read

  const content = Buffer.from(JSON.stringify(next, null, 2), "utf-8").toString(
    "base64",
  );
  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: KODY_CONFIG_PATH,
    message:
      commitMessage ??
      (existingSha
        ? "chore(kody): set engine model"
        : "chore(kody): create engine config"),
    content,
    ...(existingSha ? { sha: existingSha } : {}),
  });
  invalidateEngineConfigCache(owner, repo);
  return { sha: data.commit.sha ?? null };
}

/**
 * Normalize an operator list: strip a leading `@`, trim, drop blanks, and
 * de-dupe case-insensitively (GitHub logins are case-insensitive) while
 * preserving the first-seen casing and order. Pure — no I/O.
 */
export function normalizeOperators(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const handle = entry.trim().replace(/^@+/, "").trim();
    if (!handle) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(handle);
  }
  return out;
}

/**
 * Read the operator list from the consumer repo's kody.config.json
 * (`github.operators`). Empty array when unset — that's the silent-failure
 * state the dashboard surfaces as a warning. Cached via `getEngineConfig`.
 */
export async function readOperators(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: { force?: boolean } = {},
): Promise<string[]> {
  const { config } = await getEngineConfig(octokit, owner, repo, options);
  const ops = config.github?.operators;
  return Array.isArray(ops) ? normalizeOperators(ops) : [];
}

/**
 * Set `github.operators` in the consumer repo's kody.config.json, preserving
 * every other field (including `github.owner`/`github.repo`). Mirrors
 * `writeEngineModel`'s merge-not-overwrite read→merge→commit so a write never
 * clobbers the engine's required keys. The list is normalized before write.
 */
export async function writeOperators(
  octokit: Octokit,
  owner: string,
  repo: string,
  operators: readonly string[],
  commitMessage?: string,
): Promise<{ sha: string | null; operators: string[] }> {
  let existing: Record<string, unknown> = {};
  let existingSha: string | null = null;
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: KODY_CONFIG_PATH,
    });
    const data = res.data;
    if (!Array.isArray(data) && "content" in data && data.content) {
      existingSha = data.sha ?? null;
      try {
        existing = JSON.parse(
          Buffer.from(data.content, "base64").toString("utf-8"),
        ) as Record<string, unknown>;
      } catch {
        existing = {};
      }
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err;
  }

  const prevGithub =
    typeof existing.github === "object" && existing.github !== null
      ? (existing.github as Record<string, unknown>)
      : {};
  const normalized = normalizeOperators(operators);

  const next: Record<string, unknown> = {
    ...existing,
    executables: existing.executables ?? { default: "run" },
    github: { owner, repo, ...prevGithub, operators: normalized },
  };
  delete next.model; // strip the legacy key the engine never read

  const content = Buffer.from(JSON.stringify(next, null, 2), "utf-8").toString(
    "base64",
  );
  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: KODY_CONFIG_PATH,
    message: commitMessage ?? "chore(kody): set operators",
    content,
    ...(existingSha ? { sha: existingSha } : {}),
  });
  invalidateEngineConfigCache(owner, repo);
  return { sha: data.commit.sha ?? null, operators: normalized };
}
