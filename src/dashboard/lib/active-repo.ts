/**
 * @fileType utility
 * @domain kody
 * @pattern url-first-active-repo
 * @ai-summary URL-first resolution of the active repo. The route
 *   (`/repo/<owner>/<repo>/…`) is the single source of truth for which repo
 *   the dashboard is operating on; the flat owner/repo mirror inside
 *   localStorage.kody_auth is only a fallback for repo-less pages
 *   (`/`, `/org`, `/settings`) and is kept in sync by auth-context.
 *   Every module that needs the active repo outside React (API headers,
 *   repo-scoped storage keys) must resolve it through this file — never by
 *   trusting the stored flat fields directly, which is how route/state
 *   drift bugs happen.
 */

import { parseRepoScopedPath, type RepoRef } from "./routes";

export interface ActiveRepo {
  owner: string;
  repo: string;
  token: string;
  repoUrl: string;
  /** Index of the resolved entry inside `auth.repos`. */
  index: number;
}

interface StoredRepoEntryLike {
  repoUrl?: unknown;
  owner?: unknown;
  repo?: unknown;
  token?: unknown;
  isLogin?: unknown;
}

export interface StoredKodyAuthLike {
  owner?: unknown;
  repo?: unknown;
  token?: unknown;
  repoUrl?: unknown;
  repos?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCompleteEntry(
  entry: StoredRepoEntryLike | null | undefined,
): entry is StoredRepoEntryLike & { owner: string; repo: string; token: string } {
  return (
    !!entry &&
    isNonEmptyString(entry.owner) &&
    isNonEmptyString(entry.repo) &&
    isNonEmptyString(entry.token)
  );
}

function refEquals(a: RepoRef, b: RepoRef): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

/**
 * Resolve the active repo entry from the stored auth blob and the current
 * pathname. Precedence: URL match → stored flat selection (last visited,
 * used on repo-less pages) → login entry → first entry → null.
 */
export function resolveActiveRepo(
  auth: StoredKodyAuthLike | null | undefined,
  pathname: string | null | undefined,
): ActiveRepo | null {
  if (!auth) return null;
  const repos: StoredRepoEntryLike[] = Array.isArray(auth.repos)
    ? (auth.repos as StoredRepoEntryLike[])
    : [];

  const fromIndex = (index: number): ActiveRepo | null => {
    const entry = repos[index];
    if (!isCompleteEntry(entry)) return null;
    return {
      owner: entry.owner,
      repo: entry.repo,
      token: entry.token,
      repoUrl: isNonEmptyString(entry.repoUrl)
        ? entry.repoUrl
        : `https://github.com/${entry.owner}/${entry.repo}`,
      index,
    };
  };

  const findIndexByRef = (ref: RepoRef): number =>
    repos.findIndex(
      (entry) =>
        isCompleteEntry(entry) &&
        refEquals({ owner: entry.owner, repo: entry.repo }, ref),
    );

  const urlRef = pathname ? parseRepoScopedPath(pathname) : null;
  if (urlRef) {
    const idx = findIndexByRef(urlRef);
    if (idx >= 0) return fromIndex(idx);
    // URL names a repo we have no credentials for — fall through to the
    // fallback chain so the caller still has a working token; the shell
    // renders the "missing repo" state for the page itself.
  }

  if (isNonEmptyString(auth.owner) && isNonEmptyString(auth.repo)) {
    const idx = findIndexByRef({ owner: auth.owner, repo: auth.repo });
    if (idx >= 0) return fromIndex(idx);
  }

  const loginIdx = repos.findIndex(
    (entry) => isCompleteEntry(entry) && entry.isLogin === true,
  );
  if (loginIdx >= 0) return fromIndex(loginIdx);

  const firstIdx = repos.findIndex((entry) => isCompleteEntry(entry));
  if (firstIdx >= 0) return fromIndex(firstIdx);

  // Legacy blob with no repos[] (pre-multi-repo) — honor the flat fields.
  if (isNonEmptyString(auth.owner) && isNonEmptyString(auth.repo)) {
    return {
      owner: auth.owner,
      repo: auth.repo,
      token: isNonEmptyString(auth.token) ? auth.token : "",
      repoUrl: isNonEmptyString(auth.repoUrl)
        ? auth.repoUrl
        : `https://github.com/${auth.owner}/${auth.repo}`,
      index: -1,
    };
  }

  return null;
}

/** Parse localStorage.kody_auth. Browser only; null on SSR/missing/corrupt. */
export function readStoredKodyAuth(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("kody_auth");
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Resolve the active repo for non-React callers from localStorage plus the
 * current URL. Browser only; null on SSR or when logged out.
 */
export function readActiveRepo(): ActiveRepo | null {
  if (typeof window === "undefined") return null;
  const pathname =
    typeof window.location?.pathname === "string"
      ? window.location.pathname
      : null;
  return resolveActiveRepo(readStoredKodyAuth(), pathname);
}

/**
 * Lowercased `owner/repo` scope for repo-scoped storage keys, or "" when no
 * repo is resolvable (logged out / SSR).
 */
export function readActiveRepoScope(): string {
  const active = readActiveRepo();
  if (!active) return "";
  return `${active.owner.toLowerCase()}/${active.repo.toLowerCase()}`;
}
