/**
 * @fileType utility
 * @domain dashboard-config
 * @pattern state-repo
 * @ai-summary Read/write per-repo plain-JSON dashboard config at
 * `dashboard.json` in the configured Kody state repo. Mirrors vault
 * store pattern (cache + in-flight dedup + 60s TTL) without crypto; this
 * file is not secret. Currently holds preview and dashboard preferences.
 */

import type { Octokit } from "@octokit/rest";

import { logger } from "@dashboard/lib/logger";
import type { PreviewEnvironment } from "@dashboard/lib/preview-environments";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";

export const DASHBOARD_CONFIG_PATH = "dashboard.json";

export interface DashboardConfig {
  version: 1;
  /**
   * Legacy single preview URL shown in Vibe pane when no issue is selected.
   * Superseded by `namedPreviews` (migrated on read), kept so existing repos
   * and Vibe fallback keep working.
   */
  defaultPreviewUrl?: string;
  /**
   * Named preview environments (Production / Staging / Dev ...) surfaced on
   * the standalone `/preview` page. Each is a base URL; Web/Admin "views" are
   * paths under whichever environment is selected.
   */
  namedPreviews?: PreviewEnvironment[];
  /**
   * Whether "Kody Brain (Fly)" row is offered in chat picker.
   * Per-repo, default `false`; Fly task execution stays driven solely by the
   * repo's `FLY_API_TOKEN`.
   */
  brainFlyChatEnabled?: boolean;
  /**
   * Branch names with live, manually-created Fly previews (e.g. `dev`).
   * Unlike PR previews there is no PR-close webhook to tear these down, so
   * this list is the leak-visibility surface for `/runner`.
   */
  branchPreviews?: string[];
}

interface CacheEntry {
  doc: DashboardConfig;
  sha: string | null;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<
  string,
  Promise<{ doc: DashboardConfig; sha: string | null }>
>();
const TTL_MS = 60_000;

function cacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function emptyDoc(): DashboardConfig {
  return { version: 1 };
}

async function fetchRaw(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ doc: DashboardConfig; sha: string | null }> {
  const file = await readStateText(
    octokit,
    owner,
    repo,
    DASHBOARD_CONFIG_PATH,
    {
      headers: { "If-None-Match": "" },
    },
  );
  if (!file) {
    return { doc: emptyDoc(), sha: null };
  }

  const parsed = JSON.parse(file.content) as DashboardConfig;
  if (parsed.version !== 1) {
    logger.warn(
      { owner, repo, version: parsed.version },
      "dashboard-config: unexpected version",
    );
    return { doc: emptyDoc(), sha: file.sha ?? null };
  }

  return { doc: parsed, sha: file.sha ?? null };
}

export async function readDashboardConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: { force?: boolean } = {},
): Promise<{ doc: DashboardConfig; sha: string | null }> {
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

export async function writeDashboardConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  doc: DashboardConfig,
  currentSha: string | null,
  commitMessage = "chore(dashboard): update dashboard config",
): Promise<{ sha: string }> {
  const res = await writeStateText({
    octokit,
    owner,
    repo,
    path: DASHBOARD_CONFIG_PATH,
    content: JSON.stringify(doc, null, 2),
    message: commitMessage,
    sha: currentSha ?? undefined,
  });
  const newSha = res.sha ?? null;
  CACHE.set(cacheKey(owner, repo), {
    doc,
    sha: newSha,
    expiresAt: Date.now() + TTL_MS,
  });
  if (!newSha) {
    logger.warn(
      { owner, repo },
      "dashboard-config: GitHub returned no sha after write",
    );
    return { sha: "" };
  }
  return { sha: newSha };
}

export function invalidateDashboardConfigCache(
  owner: string,
  repo: string,
): void {
  CACHE.delete(cacheKey(owner, repo));
}

/**
 * Add or remove a branch from `branchPreviews`, reading the freshest doc first
 * so concurrent create/destroy calls do not clobber each other. Idempotent:
 * adding a known branch or removing an unknown one is a no-op write-wise.
 */
export async function setBranchPreview(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  present: boolean,
): Promise<string[]> {
  const { doc, sha } = await readDashboardConfig(octokit, owner, repo, {
    force: true,
  });
  const current = doc.branchPreviews ?? [];
  const has = current.includes(branch);
  if (present === has) return current;

  const nextList = present
    ? [...current, branch]
    : current.filter((b) => b !== branch);
  const next: DashboardConfig = {
    ...doc,
    version: 1,
    branchPreviews: nextList.length > 0 ? nextList : undefined,
  };

  await writeDashboardConfig(
    octokit,
    owner,
    repo,
    next,
    sha,
    present
      ? `chore(dashboard): track branch preview ${branch}`
      : `chore(dashboard): drop branch preview ${branch}`,
  );
  invalidateDashboardConfigCache(owner, repo);
  return nextList;
}
