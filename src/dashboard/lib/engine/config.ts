/**
 * @fileType utility
 * @domain engine
 * @pattern engine-config
 * @ai-summary Reads and caches the kody.config.json file from a consumer repo.
 */

import type { Octokit } from "@octokit/rest";

export const KODY_CONFIG_PATH = "kody.config.json";

/** The verification commands the engine runs on the code it produces. Empty
 * string / absent means "skip that check". Keys mirror the engine's
 * `config.quality` block (kody2 `loadConfig`). */
export interface KodyQuality {
  typecheck?: string;
  lint?: string;
  format?: string;
  testUnit?: string;
}

export interface KodyConfig {
  /** The model the engine runs, as `provider/model`. This is the key the
   * kody-engine actually reads (`parseProviderModel(cfg.agent.model)`).
   * `perExecutable` overrides the model for a specific executable slug
   * (e.g. `{ "research": "anthropic/claude-opus-4-7" }`). */
  agent?: {
    model?: string;
    perExecutable?: Record<string, string>;
  };
  executables: {
    default: string;
  };
  /** Executable that runs for a bare `@kody` comment on an **issue**. This is
   * the field the engine actually reads (`config.defaultExecutable`, defaults
   * to `classify`) — distinct from the dashboard's `executables.default`
   * seed, which the engine ignores for dispatch. */
  defaultExecutable?: string;
  /** Executable that runs for a bare `@kody` comment on a **PR**
   * (`config.defaultPrExecutable`, defaults to `fix`). */
  defaultPrExecutable?: string;
  /** Engine repo context plus the operator list. `operators` is the set of
   * GitHub logins that recommendation duties (pr-health/CTO) @-mention so the
   * comment routes into their dashboard inbox. Empty/absent = nobody is
   * tagged, so recommendations post but reach no inbox. */
  github?: {
    owner?: string;
    repo?: string;
    operators?: string[];
  };
  /** Verification commands the engine runs (typecheck/lint/format/test). */
  quality?: KodyQuality;
  /** Comment subcommand aliases, e.g. `{ "build": "run" }` lets `@kody build`
   * dispatch the `run` executable. */
  aliases?: Record<string, string>;
  /** Who may trigger `@kody`. `allowedAssociations` gates by GitHub author
   * association (OWNER/MEMBER/COLLABORATOR/CONTRIBUTOR/NONE). Absent = engine
   * default (no association gate). */
  access?: {
    allowedAssociations?: string[];
  };
  /** Git defaults the engine reads. `defaultBranch` is the base branch new
   * work branches off / targets (engine default: `main`). */
  git?: {
    defaultBranch?: string;
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
        defaultExecutable: parsed.defaultExecutable,
        defaultPrExecutable: parsed.defaultPrExecutable,
        quality: parsed.quality,
        aliases: parsed.aliases,
        access: parsed.access,
        git: parsed.git,
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
 * Shared read→merge→commit→invalidate for kody.config.json. Reads the current
 * file (tolerating 404 = new file and corrupt JSON), hands the parsed object to
 * `mutate`, which returns the next object, then strips the legacy top-level
 * `model` key (the engine never read it) and commits.
 *
 * Every config writer goes through here so the merge-not-overwrite contract —
 * never clobber the engine's required keys (`github`, `executables`,
 * `quality`, …) — lives in exactly one place. Mutators are responsible for
 * seeding the engine-required defaults (`executables`, `github`) on a fresh
 * file; `mutate` always receives the full existing object to spread from.
 */
async function mutateConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  mutate: (existing: Record<string, unknown>) => Record<string, unknown>,
  commitMessage: string,
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

  const next = mutate(existing);
  delete next.model; // strip the legacy key the engine never read

  const content = Buffer.from(JSON.stringify(next, null, 2), "utf-8").toString(
    "base64",
  );
  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: KODY_CONFIG_PATH,
    message: commitMessage,
    content,
    ...(existingSha ? { sha: existingSha } : {}),
  });
  invalidateEngineConfigCache(owner, repo);
  return { sha: data.commit.sha ?? null };
}

/**
 * Set `agent.model` in the consumer repo's kody.config.json, preserving every
 * other field. This is the ONLY key the engine reads for its model
 * (`parseProviderModel(cfg.agent.model)`), so writing anything else is a no-op
 * from the engine's perspective. When the file doesn't exist yet we seed the
 * minimum the engine needs (`github`, `executables`).
 */
export async function writeEngineModel(
  octokit: Octokit,
  owner: string,
  repo: string,
  modelSpec: string | null,
  commitMessage?: string,
): Promise<{ sha: string | null }> {
  return mutateConfig(
    octokit,
    owner,
    repo,
    (existing) => {
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
      return next;
    },
    commitMessage ?? "chore(kody): set engine model",
  );
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
  const normalized = normalizeOperators(operators);
  const { sha } = await mutateConfig(
    octokit,
    owner,
    repo,
    (existing) => {
      const prevGithub =
        typeof existing.github === "object" && existing.github !== null
          ? (existing.github as Record<string, unknown>)
          : {};
      return {
        ...existing,
        executables: existing.executables ?? { default: "run" },
        github: { owner, repo, ...prevGithub, operators: normalized },
      };
    },
    commitMessage ?? "chore(kody): set operators",
  );
  return { sha, operators: normalized };
}

/**
 * Set the bare-`@kody` default executable(s) in the consumer repo's
 * kody.config.json. `target: "issue"` writes `defaultExecutable`, `"pr"`
 * writes `defaultPrExecutable` — the two top-level fields the engine reads
 * when a comment is just `@kody` with no verb (see kody2/src/dispatch.ts).
 * A `null` value clears the field, reverting to the engine's built-in default
 * (`classify` for issues, `fix` for PRs). Mirrors `writeOperators`'
 * read→merge→commit so it never clobbers other config keys.
 */
export async function writeDefaultExecutable(
  octokit: Octokit,
  owner: string,
  repo: string,
  target: "issue" | "pr",
  executable: string | null,
  commitMessage?: string,
): Promise<{ sha: string | null }> {
  const key = target === "issue" ? "defaultExecutable" : "defaultPrExecutable";
  return mutateConfig(
    octokit,
    owner,
    repo,
    (existing) => {
      const next: Record<string, unknown> = {
        ...existing,
        executables: existing.executables ?? { default: "run" },
        github: existing.github ?? { owner, repo },
      };
      if (executable && executable.trim().length > 0) {
        next[key] = executable.trim();
      } else {
        delete next[key];
      }
      return next;
    },
    commitMessage ??
      `chore(kody): set default ${target} executable${executable ? ` to ${executable}` : ""}`,
  );
}

// ─── Editable config fields (Company page / models page) ───────────────────

/** GitHub author-association values `access.allowedAssociations` accepts. */
export const VALID_ASSOCIATIONS = [
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
  "CONTRIBUTOR",
  "FIRST_TIMER",
  "FIRST_TIME_CONTRIBUTOR",
  "MANNEQUIN",
  "NONE",
] as const;

export type AuthorAssociation = (typeof VALID_ASSOCIATIONS)[number];

/** Keep only known quality keys whose command is a non-empty trimmed string. */
function cleanCommands(q: KodyQuality): KodyQuality {
  const out: KodyQuality = {};
  for (const key of ["typecheck", "lint", "format", "testUnit"] as const) {
    const v = q[key]?.trim();
    if (v) out[key] = v;
  }
  return out;
}

/** Trim keys + values, drop entries where either side is blank. */
function cleanStringMap(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    const key = k.trim().replace(/^@+/, "");
    const val = typeof v === "string" ? v.trim() : "";
    if (key && val) out[key] = val;
  }
  return out;
}

/** Uppercase, keep only valid GitHub associations, de-dupe (order-preserving). */
export function normalizeAssociations(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const v = entry.trim().toUpperCase();
    if (!v || seen.has(v)) continue;
    if (!(VALID_ASSOCIATIONS as readonly string[]).includes(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * A partial update to the dashboard-editable config fields. `undefined` leaves
 * the field unchanged; `null` (or an empty value after cleaning) clears it,
 * reverting to the engine's built-in default.
 */
export interface ConfigPatch {
  quality?: KodyQuality | null;
  aliases?: Record<string, string> | null;
  allowedAssociations?: string[] | null;
  defaultBranch?: string | null;
  perExecutable?: Record<string, string> | null;
  /** Bare-`@kody` issue default (`defaultExecutable`). Edited on /executables;
   * also carried by the company bundle. */
  defaultExecutable?: string | null;
  /** Bare-`@kody` PR default (`defaultPrExecutable`). */
  defaultPrExecutable?: string | null;
}

/**
 * Apply a {@link ConfigPatch} to the consumer repo's kody.config.json,
 * preserving every untouched field. Mirrors the other writers'
 * merge-not-overwrite contract via {@link mutateConfig}. Each present key is
 * cleaned/validated before write; clearing a field removes it entirely so the
 * engine falls back to its own default.
 */
export async function writeConfigPatch(
  octokit: Octokit,
  owner: string,
  repo: string,
  patch: ConfigPatch,
  commitMessage?: string,
): Promise<{ sha: string | null }> {
  return mutateConfig(
    octokit,
    owner,
    repo,
    (existing) => {
      const next: Record<string, unknown> = {
        ...existing,
        executables: existing.executables ?? { default: "run" },
        github: existing.github ?? { owner, repo },
      };

      if (patch.quality !== undefined) {
        const cleaned = patch.quality ? cleanCommands(patch.quality) : {};
        if (Object.keys(cleaned).length > 0) next.quality = cleaned;
        else delete next.quality;
      }

      if (patch.aliases !== undefined) {
        const cleaned = patch.aliases ? cleanStringMap(patch.aliases) : {};
        if (Object.keys(cleaned).length > 0) next.aliases = cleaned;
        else delete next.aliases;
      }

      if (patch.allowedAssociations !== undefined) {
        const list = patch.allowedAssociations
          ? normalizeAssociations(patch.allowedAssociations)
          : [];
        const prevAccess =
          typeof existing.access === "object" && existing.access !== null
            ? (existing.access as Record<string, unknown>)
            : {};
        if (list.length > 0) {
          next.access = { ...prevAccess, allowedAssociations: list };
        } else {
          const { allowedAssociations: _drop, ...rest } = prevAccess;
          if (Object.keys(rest).length > 0) next.access = rest;
          else delete next.access;
        }
      }

      if (patch.defaultBranch !== undefined) {
        const branch = patch.defaultBranch?.trim();
        const prevGit =
          typeof existing.git === "object" && existing.git !== null
            ? (existing.git as Record<string, unknown>)
            : {};
        if (branch) {
          next.git = { ...prevGit, defaultBranch: branch };
        } else {
          const { defaultBranch: _drop, ...rest } = prevGit;
          if (Object.keys(rest).length > 0) next.git = rest;
          else delete next.git;
        }
      }

      if (patch.perExecutable !== undefined) {
        const cleaned = patch.perExecutable
          ? cleanStringMap(patch.perExecutable)
          : {};
        const prevAgent =
          typeof existing.agent === "object" && existing.agent !== null
            ? (existing.agent as Record<string, unknown>)
            : {};
        if (Object.keys(cleaned).length > 0) {
          next.agent = { ...prevAgent, perExecutable: cleaned };
        } else {
          const { perExecutable: _drop, ...rest } = prevAgent;
          if (Object.keys(rest).length > 0) next.agent = rest;
          else delete next.agent;
        }
      }

      for (const key of ["defaultExecutable", "defaultPrExecutable"] as const) {
        if (patch[key] === undefined) continue;
        const val = patch[key]?.trim();
        if (val) next[key] = val;
        else delete next[key];
      }

      return next;
    },
    commitMessage ?? "chore(kody): update config",
  );
}
