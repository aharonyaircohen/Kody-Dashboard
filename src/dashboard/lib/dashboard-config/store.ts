/**
 * @fileType utility
 * @domain dashboard-config
 * @pattern github-contents
 * @ai-summary Read/write a per-repo plain-JSON dashboard config at
 *   `.kody/dashboard.json` in the connected GitHub repo. Mirrors the vault
 *   store pattern (cache + in-flight dedup + 60s TTL) without crypto — this
 *   file is not secret. Currently holds the Vibe page's default preview URL.
 */

import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";
import type { PreviewEnvironment } from "@dashboard/lib/preview-environments";

export const DASHBOARD_CONFIG_PATH = ".kody/dashboard.json";

export interface DashboardConfig {
  version: 1;
  /**
   * Legacy single preview URL — shown in the Vibe pane when no issue is
   * selected. Superseded by `namedPreviews` (migrated on read), kept so
   * existing repos and the Vibe fallback keep working.
   */
  defaultPreviewUrl?: string;
  /**
   * Named preview environments (Production / Staging / Dev …) surfaced on the
   * standalone `/preview` page. Each is a base URL; the Web/Admin "views" are
   * paths under whichever environment is selected.
   */
  namedPreviews?: PreviewEnvironment[];
  /**
   * Whether the "Kody Brain (Fly)" row is offered in the chat picker.
   * Per-repo, default `false` — Fly task *execution* is independent of
   * this and stays driven solely by the repo's `FLY_API_TOKEN`.
   */
  brainFlyChatEnabled?: boolean;
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
): Promise<{ doc: DashboardConfig; sha: string | null }> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: DASHBOARD_CONFIG_PATH,
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
    const parsed = JSON.parse(buf.toString("utf8")) as DashboardConfig;
    if (parsed.version !== 1) {
      logger.warn(
        { owner, repo, version: parsed.version },
        "dashboard-config: unexpected version",
      );
      return { doc: emptyDoc(), sha: data.sha ?? null };
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
  const content = Buffer.from(JSON.stringify(doc, null, 2), "utf8").toString(
    "base64",
  );
  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: DASHBOARD_CONFIG_PATH,
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
