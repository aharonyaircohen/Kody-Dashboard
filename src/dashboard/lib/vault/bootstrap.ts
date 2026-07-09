/**
 * @fileType utility
 * @domain vault
 * @pattern public-vault-bootstrap
 * @ai-summary Resolve a repo's GitHub token from its vault WITHOUT already
 *   holding a token — the bootstrap case for unauthenticated server flows
 *   (the GitHub webhook receiver). Works only when the configured state repo
 *   vault blob is publicly readable: we fetch `kody.config.json`
 *   unauthenticated, resolve its state repo target, fetch `secrets.enc` there,
 *   then decrypt with `KODY_MASTER_KEY` (the only secret Vercel holds).
 *
 *   Cached per-repo (10 min) so the unauthenticated 60-req/hr/IP limit is never
 *   the bottleneck — one vault read per repo per window, not per webhook.
 *   Returns null on any failure (private repo / 404 / missing secret / bad
 *   key) so callers fail soft exactly as before.
 */
import { decrypt, isVaultConfigured } from "./crypto";
import { VAULT_PATH } from "./store";
import { KODY_CONFIG_PATH } from "../engine/config";
import {
  normalizeStateBasePath,
  normalizeStateBranch,
  normalizeStatePath,
  parseStateRepoSlug,
  stateRepoPath,
  type StateRepoTarget,
} from "../state-repo";
import {
  createGitHubStorageAdapter,
  createGitHubStorageFetchClient,
} from "../storage";

const GITHUB_API = "https://api.github.com";
const CACHE_TTL_MS = 10 * 60 * 1000;

interface VaultDoc {
  secrets?: Record<string, { value?: unknown }>;
}

interface RawStateConfig {
  repo?: unknown;
  path?: unknown;
  branch?: unknown;
}

interface RawKodyConfig {
  state?: RawStateConfig;
  stateRepo?: unknown;
  statePath?: unknown;
  stateBranch?: unknown;
}

const cache = new Map<string, { token: string | null; expiresAt: number }>();

/**
 * Read `secretName` (default `GITHUB_TOKEN`) from a public repo's vault using
 * only `KODY_MASTER_KEY`. Null if the repo isn't public, the vault/secret is
 * absent, or the master key is unset/wrong. Never throws.
 */
export async function resolveVaultGithubToken(
  owner: string,
  repo: string,
  secretName = "GITHUB_TOKEN",
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const key = `${owner}/${repo}/${secretName}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const token = await readOnce(owner, repo, secretName, fetchImpl);
  cache.set(key, { token, expiresAt: Date.now() + CACHE_TTL_MS });
  return token;
}

/**
 * Read a non-secret variable from a public repo's state `variables.json`
 * without holding a token — the plain-config sibling of
 * `resolveVaultGithubToken`. Null on any failure. Never throws.
 */
export async function resolvePublicStateVariable(
  owner: string,
  repo: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const key = `var:${owner}/${repo}/${name}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  let value: string | null = null;
  try {
    const target = await resolvePublicStateRepo(owner, repo, fetchImpl);
    const file = await createGitHubStorageAdapter(
      createGitHubStorageFetchClient(fetchImpl),
    ).readText(
      { owner: target.owner, repo: target.repo },
      stateRepoPath(target, "variables.json"),
    );
    if (file) {
      const doc = JSON.parse(file.content) as {
        variables?: Record<string, { value?: unknown }>;
      };
      const raw = doc.variables?.[name]?.value;
      value = typeof raw === "string" && raw.trim() ? raw : null;
    }
  } catch {
    value = null;
  }
  cache.set(key, { token: value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function readOnce(
  owner: string,
  repo: string,
  secretName: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  if (!isVaultConfigured()) return null;
  try {
    const target = await resolvePublicStateRepo(owner, repo, fetchImpl);
    const file = await createGitHubStorageAdapter(
      createGitHubStorageFetchClient(fetchImpl),
    ).readText(
      { owner: target.owner, repo: target.repo },
      stateRepoPath(target, VAULT_PATH),
    );
    if (!file) return null;
    const payload = file.content.trim();
    const doc = JSON.parse(decrypt(payload)) as VaultDoc;
    const value = doc.secrets?.[secretName]?.value;
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  }
}

async function resolvePublicStateRepo(
  owner: string,
  repo: string,
  fetchImpl: typeof fetch,
): Promise<StateRepoTarget> {
  const config = await readPublicConfig(owner, repo, fetchImpl);
  const nested =
    config?.state && typeof config.state === "object" ? config.state : {};
  const repoRaw =
    typeof config?.stateRepo === "string" ? config.stateRepo : nested.repo;
  const pathRaw =
    typeof config?.statePath === "string" ? config.statePath : nested.path;
  const branchRaw =
    typeof config?.stateBranch === "string" ? config.stateBranch : nested.branch;
  const stateRepo =
    typeof repoRaw === "string" && repoRaw.trim().length > 0
      ? repoRaw.trim()
      : `https://github.com/${owner}/kody-state`;
  const parsed = parseStateRepoSlug(stateRepo, "state.repo");
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    basePath:
      typeof pathRaw === "string"
        ? // Explicit path — "" means root (fix: Allow root Kody state path).
          normalizeStateBasePath(pathRaw, "state.path")
        : normalizeStatePath(repo, "state.path"),
    branch:
      typeof branchRaw === "string" && branchRaw.trim().length > 0
        ? normalizeStateBranch(branchRaw, "state.branch")
        : normalizeStateBranch(undefined, "state.branch"),
  };
}

async function readPublicConfig(
  owner: string,
  repo: string,
  fetchImpl: typeof fetch,
): Promise<RawKodyConfig | null> {
  const res = await fetchContents(owner, repo, KODY_CONFIG_PATH, fetchImpl);
  if (!res.ok) return null;
  const body = (await res.json()) as { content?: string; encoding?: string };
  if (!body.content) return null;
  const raw = Buffer.from(
    body.content,
    (body.encoding ?? "base64") as BufferEncoding,
  ).toString("utf8");
  return JSON.parse(raw) as RawKodyConfig;
}

function fetchContents(
  owner: string,
  repo: string,
  path: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return fetchImpl(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "kody-dashboard",
      },
    },
  );
}
