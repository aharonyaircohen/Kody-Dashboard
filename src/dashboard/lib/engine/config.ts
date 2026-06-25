/**
 * @fileType utility
 * @domain engine
 * @pattern engine-config
 * @ai-summary Reads and caches the kody.config.json file from a consumer repo.
 */

import type { Octokit } from "@octokit/rest";
import { updateGitHubFileWithRetry } from "@dashboard/lib/github-contents-write";

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

export interface ActiveGoalConfigObject {
  template: string;
  every?: string;
  idPrefix?: string;
  facts?: Record<string, unknown>;
}

export type ActiveGoalConfigEntry = string | ActiveGoalConfigObject;

export interface KodyStateConfig {
  repo?: string;
  path?: string;
}

export interface KodyConfig {
  /** The model the engine runs, as `provider/model`. This is the key the
   * kody-engine actually reads (`parseProviderModel(cfg.agent.model)`).
   * `perAgentAction` overrides the model for a specific agentAction slug
   * (e.g. `{ "research": "anthropic/claude-opus-4-7" }`). */
  agent?: {
    model?: string;
    perAgentAction?: Record<string, string>;
    /**
     * Thinking level for the engine. Written by the dashboard's
     * `/engine` page and read by the engine's chat turn as the
     * canonical default when no `REASONING_EFFORT` env override is
     * present. Off / unset = no thinking block (cheapest).
     */
    reasoningEffort?: string;
  };
  agentActions: {
    default: string;
  };
  /** AgentAction that runs for a bare `@kody` comment on an **issue**. This is
   * the field the engine actually reads (`config.defaultAgentAction`, defaults
   * to `classify`) — distinct from the dashboard's `agentActions.default`
   * seed, which the engine ignores for dispatch. */
  defaultAgentAction?: string;
  /** AgentAction that runs for a bare `@kody` comment on a **PR**
   * (`config.defaultPrAgentAction`, defaults to `fix`). */
  defaultPrAgentAction?: string;
  /** Engine repo context plus the operator list. `operators` is the set of
   * GitHub logins that recommendation agentResponsibilities (pr-health/CTO) @-mention so the
   * comment routes into their dashboard inbox. Empty/absent = nobody is
   * tagged, so recommendations post but reach no inbox. */
  github?: {
    owner?: string;
    repo?: string;
    operators?: string[];
  };
  /** External Kody runtime-state repository and per-consumer path. */
  state?: KodyStateConfig;
  /** Verification commands the engine runs (typecheck/lint/format/test). */
  quality?: KodyQuality;
  /** Comment subcommand aliases, e.g. `{ "build": "run" }` lets `@kody build`
   * dispatch the `run` agentAction. */
  aliases?: Record<string, string>;
  /** Who may trigger `@kody`. `allowedAssociations` gates by GitHub author
   * association (OWNER/MEMBER/COLLABORATOR/CONTRIBUTOR/NONE). Absent = engine
   * default (no association gate). */
  access?: {
    allowedAssociations?: string[];
  };
  /** Store catalog items this repo explicitly enables. */
  company?: {
    activeAgents?: string[];
    activeAgentActions?: string[];
    activeAgentResponsibilities?: string[];
    activeCommands?: string[];
    activeGoals?: ActiveGoalConfigEntry[];
  };
  /** Git defaults the engine reads. `defaultBranch` is the base branch new
   * work branches off / targets (engine default: `main`). */
  git?: {
    defaultBranch?: string;
  };
  /** Non-secret Fly infrastructure knobs the dashboard + preview builder read.
   * The Fly token, org slug, and region stay in the vault (they're secret /
   * billing-scoped); only the plain config that used to be hardcoded in the
   * builder lives here so the Fly panel can edit it. */
  fly?: KodyFlyConfig;
}

/** Per-repo Fly preview-machine settings. All optional; absent fields fall
 * back to {@link resolveFlyPreviews} defaults. These used to be hardcoded in
 * `builder/src/fly-api.ts` — moving them here makes them editable from the
 * Fly panel without a builder redeploy per change. */
export interface KodyFlyPreviews {
  /** vCPUs for each per-PR preview machine. */
  cpus?: number;
  /** RAM (MB) for each per-PR preview machine. Keep the default at 2048
   * because Fly suspend is only supported/recommended at <= 2 GB. Dev-mode
   * previews can opt into 4096, but they cold-stop instead of suspending. */
  memoryMb?: number;
  /** When true, idle previews sleep and wake on request. At <= 2 GB this uses
   * Fly suspend; larger previews use stop because suspend is not supported /
   * recommended there. */
  idleSuspend?: boolean;
  /** When true, attach an HTTP health check that pings the machine. WARNING:
   * a health check keeps the machine "active" so it never idles → never
   * suspends. Defaults OFF so `idleSuspend` actually fires. */
  healthCheck?: boolean;
  /** Auto-destroy a preview this many days after creation. 0 / absent = keep
   * forever (the sweep skips it). */
  ttlDays?: number;
  /** vCPUs for the temporary build worker that creates a preview. */
  builderCpus?: number;
  /** RAM (MB) for the temporary build worker that creates a preview. */
  builderMemoryMb?: number;
}

export interface KodyFlyConfig {
  previews?: KodyFlyPreviews;
}

/** Fully-resolved preview knobs — every field present. */
export interface ResolvedFlyPreviews {
  cpus: number;
  memoryMb: number;
  idleSuspend: boolean;
  healthCheck: boolean;
  ttlDays: number;
  builderCpus: number;
  builderMemoryMb: number;
}

/** Defaults chosen so previews are eligible for Fly suspend and health-checks
 * stay off by default (checks would keep idle machines awake forever). */
export const DEFAULT_FLY_PREVIEWS: ResolvedFlyPreviews = {
  cpus: 2,
  memoryMb: 2048,
  idleSuspend: true,
  healthCheck: false,
  // Auto-delete previews 14 days after creation by default — keeps stale PR
  // previews from piling up forever. A repo can override (higher = keep
  // longer; the UI caps at 365).
  ttlDays: 14,
  // Short-lived build workers can be larger than idle preview machines.
  builderCpus: 4,
  builderMemoryMb: 4096,
};

/** Merge a repo's `fly.previews` over the defaults. Pure — no I/O. */
export function resolveFlyPreviews(cfg: KodyConfig): ResolvedFlyPreviews {
  const p = cfg.fly?.previews ?? {};
  return {
    cpus:
      typeof p.cpus === "number" && p.cpus > 0
        ? p.cpus
        : DEFAULT_FLY_PREVIEWS.cpus,
    memoryMb:
      typeof p.memoryMb === "number" && p.memoryMb > 0
        ? p.memoryMb
        : DEFAULT_FLY_PREVIEWS.memoryMb,
    idleSuspend:
      typeof p.idleSuspend === "boolean"
        ? p.idleSuspend
        : DEFAULT_FLY_PREVIEWS.idleSuspend,
    healthCheck:
      typeof p.healthCheck === "boolean"
        ? p.healthCheck
        : DEFAULT_FLY_PREVIEWS.healthCheck,
    ttlDays:
      typeof p.ttlDays === "number" && p.ttlDays > 0
        ? Math.floor(p.ttlDays)
        : DEFAULT_FLY_PREVIEWS.ttlDays,
    builderCpus:
      typeof p.builderCpus === "number" && p.builderCpus > 0
        ? p.builderCpus
        : DEFAULT_FLY_PREVIEWS.builderCpus,
    builderMemoryMb:
      typeof p.builderMemoryMb === "number" && p.builderMemoryMb > 0
        ? p.builderMemoryMb
        : DEFAULT_FLY_PREVIEWS.builderMemoryMb,
  };
}

/** Default config when no kody.config.json exists in the repo. */
export const defaultConfig: KodyConfig = {
  agentActions: {
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

type ReposApi = {
  getContent: (params: {
    owner: string;
    repo: string;
    path: string;
  }) => Promise<{ data: unknown }>;
};

function getReposApi(octokit: Octokit): ReposApi {
  const candidate = octokit as Octokit & { repos?: unknown };
  const repos = candidate.rest?.repos ?? candidate.repos;
  if (!repos || typeof repos !== "object") {
    throw new Error("github_contents_api_missing");
  }
  return repos as ReposApi;
}

function cacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

async function fetchConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ config: KodyConfig; sha: string | null }> {
  try {
    const res = await getReposApi(octokit).getContent({
      owner,
      repo,
      path: KODY_CONFIG_PATH,
    });
    const data = res.data as
      | { content?: string; sha?: string }
      | Array<unknown>;
    if (Array.isArray(data) || !("content" in data) || !data.content) {
      return { config: defaultConfig, sha: null };
    }
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    const parsed = JSON.parse(content) as KodyConfig;
    const parsedWithStateAliases = parsed as KodyConfig & {
      stateRepo?: string;
      statePath?: string;
    };
    return {
      config: {
        agentActions: parsed.agentActions ?? { default: "run" },
        agent: parsed.agent,
        github: parsed.github,
        state:
          parsed.state ??
          (parsedWithStateAliases.stateRepo || parsedWithStateAliases.statePath
            ? {
                repo: parsedWithStateAliases.stateRepo,
                path: parsedWithStateAliases.statePath,
              }
            : undefined),
        defaultAgentAction: parsed.defaultAgentAction,
        defaultPrAgentAction: parsed.defaultPrAgentAction,
        quality: parsed.quality,
        aliases: parsed.aliases,
        access: parsed.access,
        git: parsed.git,
        fly: parsed.fly,
        company: parsed.company,
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
 * `model` key (the engine never read it) and commits. If GitHub rejects the
 * write because the contents SHA went stale, the mutation is re-applied once
 * over a freshly read file.
 *
 * Every config writer goes through here so the merge-not-overwrite contract —
 * never clobber the engine's required keys (`github`, `agentActions`,
 * `quality`, …) — lives in exactly one place. Mutators are responsible for
 * seeding the engine-required defaults (`agentActions`, `github`) on a fresh
 * file; `mutate` always receives the full existing object to spread from.
 */
function parseConfigForWrite(
  contentBase64: string | null,
): Record<string, unknown> {
  if (!contentBase64) return {};
  try {
    return JSON.parse(
      Buffer.from(contentBase64, "base64").toString("utf-8"),
    ) as Record<string, unknown>;
  } catch {
    // Corrupt JSON — start clean rather than propagate parse error,
    // but keep sha so we replace the bad file.
    return {};
  }
}

async function mutateConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  mutate: (existing: Record<string, unknown>) => Record<string, unknown>,
  commitMessage: string,
): Promise<{ sha: string | null }> {
  const result = await updateGitHubFileWithRetry(octokit, {
    owner,
    repo,
    path: KODY_CONFIG_PATH,
    message: commitMessage,
    maxAttempts: 2,
    onConflict: () => invalidateEngineConfigCache(owner, repo),
    mutate: (current) => {
      const existing = parseConfigForWrite(current?.contentBase64 ?? null);
      const next = mutate(existing);
      delete next.model; // strip the legacy key the engine never read
      return {
        content: Buffer.from(JSON.stringify(next, null, 2), "utf-8").toString(
          "base64",
        ),
      };
    },
  });
  invalidateEngineConfigCache(owner, repo);
  return { sha: result.commitSha };
}

/**
 * Set `agent.model` in the consumer repo's kody.config.json, preserving every
 * other field. This is the ONLY key the engine reads for its model
 * (`parseProviderModel(cfg.agent.model)`), so writing anything else is a no-op
 * from the engine's perspective. When the file doesn't exist yet we seed the
 * minimum the engine needs (`github`, `agentActions`).
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
        agentActions: existing.agentActions ?? { default: "run" },
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
        agentActions: existing.agentActions ?? { default: "run" },
        github: { owner, repo, ...prevGithub, operators: normalized },
      };
    },
    commitMessage ?? "chore(kody): set operators",
  );
  return { sha, operators: normalized };
}

/**
 * Set the bare-`@kody` default agentAction(s) in the consumer repo's
 * kody.config.json. `target: "issue"` writes `defaultAgentAction`, `"pr"`
 * writes `defaultPrAgentAction` — the two top-level fields the engine reads
 * when a comment is just `@kody` with no verb (see kody2/src/dispatch.ts).
 * A `null` value clears the field, reverting to the engine's built-in default
 * (`classify` for issues, `fix` for PRs). Mirrors `writeOperators`'
 * read→merge→commit so it never clobbers other config keys.
 */
export async function writeDefaultAgentAction(
  octokit: Octokit,
  owner: string,
  repo: string,
  target: "issue" | "pr",
  agentAction: string | null,
  commitMessage?: string,
): Promise<{ sha: string | null }> {
  const key =
    target === "issue" ? "defaultAgentAction" : "defaultPrAgentAction";
  return mutateConfig(
    octokit,
    owner,
    repo,
    (existing) => {
      const next: Record<string, unknown> = {
        ...existing,
        agentActions: existing.agentActions ?? { default: "run" },
        github: existing.github ?? { owner, repo },
      };
      if (agentAction && agentAction.trim().length > 0) {
        next[key] = agentAction.trim();
      } else {
        delete next[key];
      }
      return next;
    },
    commitMessage ??
      `chore(kody): set default ${target} agentAction${agentAction ? ` to ${agentAction}` : ""}`,
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

function cleanSlug(value: unknown): string {
  if (typeof value !== "string") return "";
  const slug = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) ? slug : "";
}

function cleanSlugList(raw: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const slug = cleanSlug(value);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

function cleanActiveGoals(
  raw: readonly ActiveGoalConfigEntry[],
): ActiveGoalConfigEntry[] {
  const seen = new Set<string>();
  const out: ActiveGoalConfigEntry[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const slug = cleanSlug(entry);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push(slug);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const template = cleanSlug(entry.template);
    if (!template || seen.has(template)) continue;
    const cleaned: ActiveGoalConfigObject = { template };
    if (
      typeof entry.every === "string" &&
      /^[1-9][0-9]*[mhdw]$/.test(entry.every.trim())
    ) {
      cleaned.every = entry.every.trim();
    }
    const idPrefix = cleanSlug(entry.idPrefix);
    if (idPrefix) cleaned.idPrefix = idPrefix;
    if (
      entry.facts &&
      typeof entry.facts === "object" &&
      !Array.isArray(entry.facts)
    ) {
      cleaned.facts = entry.facts;
    }
    seen.add(template);
    out.push(cleaned);
  }
  return out;
}

function companyRecordFrom(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function setCompanyField(
  next: Record<string, unknown>,
  key:
    | "activeAgents"
    | "activeAgentActions"
    | "activeAgentResponsibilities"
    | "activeCommands"
    | "activeGoals",
  value: string[] | ActiveGoalConfigEntry[],
): void {
  const prevCompany = companyRecordFrom(next.company);
  if (value.length > 0) {
    next.company = { ...prevCompany, [key]: value };
    return;
  }
  const { [key]: _drop, ...rest } = prevCompany;
  if (Object.keys(rest).length > 0) next.company = rest;
  else delete next.company;
}

/** Keep only valid Fly preview knobs: positive numbers for size/ttl, real
 * booleans for the toggles. Drops anything blank/invalid so a fresh repo
 * stays at {@link DEFAULT_FLY_PREVIEWS}. */
function cleanFlyPreviews(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [
    "cpus",
    "memoryMb",
    "ttlDays",
    "builderCpus",
    "builderMemoryMb",
  ] as const) {
    const v = raw[key];
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0) out[key] = Math.floor(n);
  }
  for (const key of ["idleSuspend", "healthCheck"] as const) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

function cleanStateConfig(
  raw: KodyStateConfig | null | undefined,
): KodyStateConfig | null {
  if (!raw) return null;
  const repo = raw.repo?.trim().replace(/\/+$/, "") ?? "";
  const path = raw.path?.trim() ?? "";
  const pathSegments = path.split("/");
  if (
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/i.test(repo)
  ) {
    return null;
  }
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    pathSegments.some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  ) {
    return null;
  }
  return { repo, path };
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
  activeAgents?: string[] | null;
  activeAgentActions?: string[] | null;
  activeAgentResponsibilities?: string[] | null;
  activeCommands?: string[] | null;
  activeGoals?: ActiveGoalConfigEntry[] | null;
  state?: KodyStateConfig | null;
  defaultBranch?: string | null;
  perAgentAction?: Record<string, string> | null;
  /** Bare-`@kody` issue default (`defaultAgentAction`). Edited on /agent-actions;
   * also carried by the company bundle. */
  defaultAgentAction?: string | null;
  /** Bare-`@kody` PR default (`defaultPrAgentAction`). */
  defaultPrAgentAction?: string | null;
  /** Fly preview-machine knobs (size, idle-suspend, health-check, TTL). A
   * partial object merges field-by-field over what's stored; `null` clears
   * the whole `fly.previews` block (reverts to {@link DEFAULT_FLY_PREVIEWS}). */
  flyPreviews?: Partial<KodyFlyPreviews> | null;
  /**
   * Thinking level for the engine (off|low|medium|high). Written to
   * `agent.reasoningEffort`. Null clears the field — engine falls back
   * to its own default (off = no thinking = cheapest path).
   */
  reasoningEffort?: string | null;
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
        agentActions: existing.agentActions ?? { default: "run" },
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

      if (patch.activeAgents !== undefined) {
        const list = patch.activeAgents
          ? cleanSlugList(patch.activeAgents)
          : [];
        setCompanyField(next, "activeAgents", list);
      }

      if (patch.activeAgentActions !== undefined) {
        const list = patch.activeAgentActions
          ? cleanSlugList(patch.activeAgentActions)
          : [];
        setCompanyField(next, "activeAgentActions", list);
      }

      if (patch.activeAgentResponsibilities !== undefined) {
        const list = patch.activeAgentResponsibilities
          ? cleanSlugList(patch.activeAgentResponsibilities)
          : [];
        setCompanyField(next, "activeAgentResponsibilities", list);
      }

      if (patch.activeCommands !== undefined) {
        const list = patch.activeCommands
          ? cleanSlugList(patch.activeCommands)
          : [];
        setCompanyField(next, "activeCommands", list);
      }

      if (patch.activeGoals !== undefined) {
        const list = patch.activeGoals
          ? cleanActiveGoals(patch.activeGoals)
          : [];
        setCompanyField(next, "activeGoals", list);
      }

      if (patch.state !== undefined) {
        const cleaned = cleanStateConfig(patch.state);
        if (cleaned) next.state = cleaned;
        else delete next.state;
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

      if (patch.perAgentAction !== undefined) {
        const cleaned = patch.perAgentAction
          ? cleanStringMap(patch.perAgentAction)
          : {};
        const prevAgent =
          typeof existing.agent === "object" && existing.agent !== null
            ? (existing.agent as Record<string, unknown>)
            : {};
        if (Object.keys(cleaned).length > 0) {
          next.agent = { ...prevAgent, perAgentAction: cleaned };
        } else {
          const { perAgentAction: _drop, ...rest } = prevAgent;
          if (Object.keys(rest).length > 0) next.agent = rest;
          else delete next.agent;
        }
      }

      for (const key of [
        "defaultAgentAction",
        "defaultPrAgentAction",
      ] as const) {
        if (patch[key] === undefined) continue;
        const val = patch[key]?.trim();
        if (val) next[key] = val;
        else delete next[key];
      }

      if (patch.flyPreviews !== undefined) {
        const prevFly =
          typeof existing.fly === "object" && existing.fly !== null
            ? (existing.fly as Record<string, unknown>)
            : {};
        const prevPreviews =
          typeof prevFly.previews === "object" && prevFly.previews !== null
            ? (prevFly.previews as Record<string, unknown>)
            : {};
        // null clears the whole previews block; a partial object merges
        // field-by-field over what's stored (so the UI can save one knob).
        const mergedPreviews = patch.flyPreviews
          ? cleanFlyPreviews({ ...prevPreviews, ...patch.flyPreviews })
          : {};
        const { previews: _drop, ...flyRest } = prevFly;
        if (Object.keys(mergedPreviews).length > 0) {
          next.fly = { ...flyRest, previews: mergedPreviews };
        } else if (Object.keys(flyRest).length > 0) {
          next.fly = flyRest;
        } else {
          delete next.fly;
        }
      }

      if (patch.reasoningEffort !== undefined) {
        const effort = patch.reasoningEffort?.trim().toLowerCase() ?? "";
        const prevAgent =
          typeof existing.agent === "object" && existing.agent !== null
            ? (existing.agent as Record<string, unknown>)
            : {};
        // Off / empty → remove the field so the engine falls back to its
        // own default. Anything else (low/medium/high, or a typo that
        // survived validation) → store the canonical value the engine
        // parser will accept.
        const VALID = ["off", "low", "medium", "high"];
        if (effort && VALID.includes(effort)) {
          next.agent = { ...prevAgent, reasoningEffort: effort };
        } else {
          const { reasoningEffort: _drop, ...rest } = prevAgent;
          if (Object.keys(rest).length > 0) next.agent = rest;
          else delete next.agent;
        }
      }

      return next;
    },
    commitMessage ?? "chore(kody): update config",
  );
}
