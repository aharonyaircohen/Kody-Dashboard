/**
 * @fileType context
 * @domain kody
 *
 * Auth context for reading stored GitHub credentials from localStorage.
 *
 * Multi-repo: stores a list of repos under `repos[]`. The *active* repo is
 * derived from the URL (`/repo/<owner>/<repo>/…` — see active-repo.ts), NOT
 * from stored state; the flat fields (owner/repo/token/repoUrl) and
 * `currentRepoIndex` exposed on `auth` are computed from the pathname each
 * render. The flat fields are still persisted as a mirror, but only as the
 * fallback for repo-less pages (/, /org, /settings) and for the brand
 * cookie — the URL always wins. Switching repos is a full-page navigation
 * to the target repo's URL (clears React Query cache and in-flight polls).
 *
 * On login: credentials stored in localStorage as JSON.
 * On logout: credentials cleared from localStorage.
 *
 * API routes read the token from a custom header set by the client
 * (x-kody-token, x-kody-owner, x-kody-repo) instead of env vars.
 */
"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { usePathname } from "next/navigation";
import { resolveActiveRepo } from "./active-repo";
import { repoBasePath } from "./routes";
import {
  DEFAULT_KODY_STORE_REF,
  DEFAULT_KODY_STORE_REPO_URL,
  buildKodyAuthHeaders,
} from "./auth-headers";
import {
  CLIENT_BRAND_REPO_COOKIE,
  serializeClientBrandRepoCookie,
} from "./client-brand-repo-cookie";

export { DEFAULT_KODY_STORE_REF, DEFAULT_KODY_STORE_REPO_URL };

export interface KodyRepoEntry {
  /** Original `https://github.com/owner/repo` URL the user pasted (optional). */
  repoUrl: string;
  owner: string;
  repo: string;
  /** GitHub PAT scoped to this repo. */
  token: string;
  /** Unix-ms when this repo was added. */
  addedAt: number;
  /** True for the original login repo (cannot be removed without logout). */
  isLogin: boolean;
}

export interface KodyAuth {
  // ─── Flat fields — always reflect the *current* repo (backward compat) ─
  repoUrl: string;
  owner: string;
  repo: string;
  token: string;
  user: {
    login: string;
    avatar_url: string;
    id: number;
  };
  loggedInAt: number;
  // ─── Multi-repo state ──────────────────────────────────────────────────
  repos: KodyRepoEntry[];
  currentRepoIndex: number;
  // ─── Optional integrations (per-browser) ───────────────────────────────
  brain?: { url: string; apiKey: string };
  vercelBypassSecret?: string;
  /**
   * Fly VM performance tier for kody-live-fly spawns. Sent as the
   * `x-kody-fly-perf` header; the server picks the matching guest config:
   *   low    → shared-cpu-2x / 2GB  (chat-only, ~$0.005/30min session)
   *   medium → performance-1x / 2GB (vibe coding, ~$0.05/30min) — default
   *   high   → performance-2x / 4GB (heavy installs/tests, ~$0.11/30min)
   */
  flyPerf?: "low" | "medium" | "high";
  /**
   * Fly VM performance tier for the per-user Brain server, INDEPENDENT of
   * `flyPerf` (task runs). Sent as `x-kody-brain-perf` on provision; same
   * guest mapping as flyPerf. Absent → server default (medium).
   */
  brainPerf?: "low" | "medium" | "high";
  /**
   * Brain Fly auto-suspension policy. Absent = auto-suspend when idle.
   */
  brainSuspension?: BrainSuspensionMode;
  /** Legacy browser key from the previous terminal-activity UI. */
  brainTerminalActivityLimit?: BrainTerminalActivityLimit;
  /** Shared Kody store repository URL used for company-level capabilities/implementations. */
  storeRepoUrl?: string;
  /** Shared Kody store ref used for company-level capabilities/implementations. */
  storeRef?: string;
}

export type FlyPerfTier = NonNullable<KodyAuth["flyPerf"]>;
export type BrainTerminalActivityLimit = number | "never";
export type BrainSuspensionMode = "auto" | "never";

interface AuthContextValue {
  auth: KodyAuth | null;
  loading: boolean;
  logout: () => void;
  /**
   * Push a new repo entry. When auth is null this *bootstraps* the auth
   * object — the caller must supply `user` (basic GitHub identity for the
   * supplied token). For subsequent adds `user` is ignored.
   * Does not switch to the new repo unless it's the bootstrap one.
   */
  addRepo: (
    entry: Omit<KodyRepoEntry, "addedAt" | "isLogin">,
    user?: KodyAuth["user"],
  ) => void;
  /** Remove a repo by index. Removing the current repo falls back to index 0. Removing the only repo logs out. */
  removeRepo: (index: number) => void;
  /** Switch the active repo. Triggers a full page reload to clear React Query cache. */
  setCurrentRepo: (
    index: number,
    options?: { redirectTo?: string; navigateBeforeCommit?: boolean },
  ) => void;
  /**
   * Update the per-browser integration fields (brain, vercelBypassSecret).
   * Pass `null` to clear a field, omit it to leave it unchanged.
   */
  updateIntegrations: (patch: {
    brain?: { url: string; apiKey: string } | null;
    vercelBypassSecret?: string | null;
    flyPerf?: FlyPerfTier | null;
    brainPerf?: FlyPerfTier | null;
    brainSuspension?: BrainSuspensionMode | null;
    brainTerminalActivityLimit?: BrainTerminalActivityLimit | null;
    storeRepoUrl?: string | null;
    storeRef?: string | null;
  }) => void;
}

const AuthContext = createContext<AuthContextValue>({
  auth: null,
  loading: true,
  logout: () => {},
  addRepo: () => {},
  removeRepo: () => {},
  setCurrentRepo: () => {},
  updateIntegrations: () => {},
});

/**
 * Migrate legacy single-repo auth (no `repos[]`) into the multi-repo shape.
 * Pure function — no localStorage writes.
 */
function migrateAuth(raw: unknown): KodyAuth | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Partial<KodyAuth> & {
    repos?: KodyRepoEntry[];
    currentRepoIndex?: number;
    storeRepo?: string;
  };

  if (!a.owner || !a.repo || !a.token || !a.user) return null;

  // Already migrated.
  if (
    Array.isArray(a.repos) &&
    a.repos.length > 0 &&
    typeof a.currentRepoIndex === "number"
  ) {
    const idx = Math.min(Math.max(0, a.currentRepoIndex), a.repos.length - 1);
    const cur = a.repos[idx];
    // Trust repos[idx] as source of truth — repaint flat fields if drifted.
    const brainSuspension =
      a.brainSuspension === "auto" || a.brainSuspension === "never"
        ? a.brainSuspension
        : a.brainTerminalActivityLimit === "never"
          ? "never"
          : undefined;
    return {
      ...(a as KodyAuth),
      currentRepoIndex: idx,
      repoUrl: cur.repoUrl,
      owner: cur.owner,
      repo: cur.repo,
      token: cur.token,
      brainSuspension,
      brainTerminalActivityLimit: undefined,
      storeRepoUrl:
        a.storeRepoUrl ??
        (typeof a.storeRepo === "string" && a.storeRepo
          ? `https://github.com/${a.storeRepo}`
          : undefined),
    };
  }

  // Legacy: build single-entry repos[].
  const loginEntry: KodyRepoEntry = {
    repoUrl: a.repoUrl ?? `https://github.com/${a.owner}/${a.repo}`,
    owner: a.owner,
    repo: a.repo,
    token: a.token,
    addedAt: a.loggedInAt ?? Date.now(),
    isLogin: true,
  };

  return {
    repoUrl: loginEntry.repoUrl,
    owner: loginEntry.owner,
    repo: loginEntry.repo,
    token: loginEntry.token,
    user: a.user,
    loggedInAt: a.loggedInAt ?? Date.now(),
    repos: [loginEntry],
    currentRepoIndex: 0,
    brain: a.brain,
    vercelBypassSecret: a.vercelBypassSecret,
    flyPerf: a.flyPerf,
    brainPerf: a.brainPerf,
    brainSuspension:
      a.brainSuspension === "auto" || a.brainSuspension === "never"
        ? a.brainSuspension
        : a.brainTerminalActivityLimit === "never"
          ? "never"
          : undefined,
    storeRepoUrl:
      a.storeRepoUrl ??
      (typeof a.storeRepo === "string" && a.storeRepo
        ? `https://github.com/${a.storeRepo}`
        : undefined),
    storeRef: a.storeRef,
  };
}

function persist(next: KodyAuth): void {
  localStorage.setItem("kody_auth", JSON.stringify(next));
  syncClientBrandRepoCookie(next);
}

function syncClientBrandRepoCookie(auth: KodyAuth): void {
  document.cookie = `${CLIENT_BRAND_REPO_COOKIE}=${serializeClientBrandRepoCookie({
    owner: auth.owner,
    repo: auth.repo,
    ...(auth.storeRepoUrl ? { storeRepoUrl: auth.storeRepoUrl } : {}),
    ...(auth.storeRef ? { storeRef: auth.storeRef } : {}),
  })}; Path=/; Max-Age=2592000; SameSite=Lax`;
}

function clearClientBrandRepoCookie(): void {
  document.cookie = `${CLIENT_BRAND_REPO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [storedAuth, setStoredAuth] = useState<KodyAuth | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  // The URL is the source of truth for the active repo: derive the flat
  // fields + currentRepoIndex from the pathname every render. The stored
  // flat fields only act as the fallback on repo-less pages.
  const auth = useMemo(() => {
    if (!storedAuth) return null;
    const active = resolveActiveRepo(storedAuth, pathname);
    if (!active) return storedAuth;
    if (
      active.index === storedAuth.currentRepoIndex &&
      active.owner === storedAuth.owner &&
      active.repo === storedAuth.repo &&
      active.token === storedAuth.token
    ) {
      return storedAuth;
    }
    return {
      ...storedAuth,
      currentRepoIndex: active.index,
      repoUrl: active.repoUrl,
      owner: active.owner,
      repo: active.repo,
      token: active.token,
    };
  }, [storedAuth, pathname]);

  // Mirror the URL-derived selection back to localStorage so repo-less
  // pages and the brand cookie follow the last visited repo. The URL still
  // wins on every read — this is a fallback hint, never a competing truth.
  useEffect(() => {
    if (!auth || auth === storedAuth) return;
    persist(auth);
    setStoredAuth(auth);
  }, [auth, storedAuth]);

  // Load auth from localStorage on mount, migrating legacy shape if needed.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("kody_auth");
      if (stored) {
        const parsed = JSON.parse(stored);
        const migrated = migrateAuth(parsed);
        if (migrated) {
          setStoredAuth(migrated);
          // Persist migration result so subsequent loads skip the legacy branch.
          persist(migrated);
        } else {
          localStorage.removeItem("kody_auth");
        }
      }
    } catch {
      // Corrupted localStorage — clear it
      localStorage.removeItem("kody_auth");
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("kody_auth");
    clearClientBrandRepoCookie();
    setStoredAuth(null);
    window.location.href = "/";
  }, []);

  const addRepo = useCallback(
    (
      entry: Omit<KodyRepoEntry, "addedAt" | "isLogin">,
      user?: KodyAuth["user"],
    ) => {
      const owner = entry.owner?.trim() ?? "";
      const repo = entry.repo?.trim() ?? "";
      const token = entry.token?.trim() ?? "";
      const nextEntry: Omit<KodyRepoEntry, "addedAt" | "isLogin"> = {
        ...entry,
        repoUrl:
          entry.repoUrl ||
          (owner && repo ? `https://github.com/${owner}/${repo}` : ""),
        owner,
        repo,
        token,
      };
      if (!nextEntry.owner || !nextEntry.repo || !nextEntry.token) {
        console.warn("Skipping malformed repository entry", {
          owner: nextEntry.owner,
          repo: nextEntry.repo,
          hasToken: Boolean(nextEntry.token),
        });
        return;
      }
      setStoredAuth((prev) => {
        // Bootstrap: empty store, this is the first repo. Requires user info.
        if (!prev) {
          if (!user) {
            // Callers MUST pass user for the bootstrap path — bail silently
            // (the form-level validation should never let this happen).
            return prev;
          }
          const now = Date.now();
          const loginEntry: KodyRepoEntry = {
            ...nextEntry,
            addedAt: now,
            isLogin: true,
          };
          const next: KodyAuth = {
            repoUrl: loginEntry.repoUrl,
            owner: loginEntry.owner,
            repo: loginEntry.repo,
            token: loginEntry.token,
            user,
            loggedInAt: now,
            repos: [loginEntry],
            currentRepoIndex: 0,
          };
          persist(next);
          return next;
        }
        const ownerLc = nextEntry.owner.toLowerCase();
        const repoLc = nextEntry.repo.toLowerCase();
        // Dedupe: if the same owner/repo already exists, replace its token instead.
        const existingIdx = prev.repos.findIndex(
          (r) =>
            r.owner?.toLowerCase() === ownerLc &&
            r.repo?.toLowerCase() === repoLc,
        );
        let nextRepos: KodyRepoEntry[];
        if (existingIdx >= 0) {
          nextRepos = prev.repos.map((r, i) =>
            i === existingIdx
              ? { ...r, token: nextEntry.token, repoUrl: nextEntry.repoUrl }
              : r,
          );
        } else {
          nextRepos = [
            ...prev.repos,
            { ...nextEntry, addedAt: Date.now(), isLogin: false },
          ];
        }
        const next: KodyAuth = { ...prev, repos: nextRepos };
        persist(next);
        return next;
      });
    },
    [],
  );

  const removeRepo = useCallback((index: number) => {
    setStoredAuth((prev) => {
      if (!prev) return prev;
      if (index < 0 || index >= prev.repos.length) return prev;

      const removing = prev.repos[index];
      if (removing.isLogin) {
        // Removing the login repo == logout.
        localStorage.removeItem("kody_auth");
        clearClientBrandRepoCookie();
        window.location.href = "/";
        return null;
      }

      const nextRepos = prev.repos.filter((_, i) => i !== index);
      if (nextRepos.length === 0) {
        // Shouldn't happen (login is non-removable), but bail to logout.
        localStorage.removeItem("kody_auth");
        clearClientBrandRepoCookie();
        window.location.href = "/";
        return null;
      }

      // Recompute current index. If we removed the current one, fall back to 0.
      let nextIdx = prev.currentRepoIndex;
      if (index === prev.currentRepoIndex) {
        nextIdx = 0;
      } else if (index < prev.currentRepoIndex) {
        nextIdx = prev.currentRepoIndex - 1;
      }
      const cur = nextRepos[nextIdx];
      const next: KodyAuth = {
        ...prev,
        repos: nextRepos,
        currentRepoIndex: nextIdx,
        repoUrl: cur.repoUrl,
        owner: cur.owner,
        repo: cur.repo,
        token: cur.token,
      };
      persist(next);
      // Removing the active repo: its URL is now dead — do a full-page
      // navigation to the fallback repo's home (also clears caches).
      if (index === prev.currentRepoIndex) {
        window.location.assign(repoBasePath(cur));
      }
      return next;
    });
  }, []);

  const setCurrentRepo = useCallback(
    (
      index: number,
      options?: { redirectTo?: string; navigateBeforeCommit?: boolean },
    ) => {
      if (!auth) return;
      if (index < 0 || index >= auth.repos.length) return;
      if (index === auth.currentRepoIndex) return;
      const cur = auth.repos[index];
      const next: KodyAuth = {
        ...auth,
        currentRepoIndex: index,
        repoUrl: cur.repoUrl,
        owner: cur.owner,
        repo: cur.repo,
        token: cur.token,
      };
      // The URL carries the repo from here on — persist only refreshes the
      // repo-less-page fallback and the brand cookie, then a full-page
      // navigation to the target repo's URL wipes React Query cache,
      // in-flight polls, and chat state.
      persist(next);
      window.location.assign(options?.redirectTo ?? repoBasePath(cur));
    },
    [auth],
  );

  const updateIntegrations = useCallback(
    (patch: {
      brain?: { url: string; apiKey: string } | null;
      vercelBypassSecret?: string | null;
      flyPerf?: FlyPerfTier | null;
      brainPerf?: FlyPerfTier | null;
      brainSuspension?: BrainSuspensionMode | null;
      brainTerminalActivityLimit?: BrainTerminalActivityLimit | null;
      storeRepoUrl?: string | null;
      storeRef?: string | null;
    }) => {
      setStoredAuth((prev) => {
        if (!prev) return prev;
        const next: KodyAuth = { ...prev };
        if (patch.brain !== undefined) {
          next.brain = patch.brain === null ? undefined : patch.brain;
        }
        if (patch.vercelBypassSecret !== undefined) {
          next.vercelBypassSecret =
            patch.vercelBypassSecret === null
              ? undefined
              : patch.vercelBypassSecret;
        }
        if (patch.flyPerf !== undefined) {
          next.flyPerf = patch.flyPerf === null ? undefined : patch.flyPerf;
        }
        if (patch.brainPerf !== undefined) {
          next.brainPerf =
            patch.brainPerf === null ? undefined : patch.brainPerf;
        }
        if (patch.brainSuspension !== undefined) {
          next.brainSuspension =
            patch.brainSuspension === null ? undefined : patch.brainSuspension;
          next.brainTerminalActivityLimit = undefined;
        }
        if (patch.brainTerminalActivityLimit !== undefined) {
          next.brainTerminalActivityLimit =
            patch.brainTerminalActivityLimit === null
              ? undefined
              : patch.brainTerminalActivityLimit;
        }
        if (patch.storeRepoUrl !== undefined) {
          const storeRepoUrl = patch.storeRepoUrl?.trim();
          next.storeRepoUrl = storeRepoUrl ? storeRepoUrl : undefined;
        }
        if (patch.storeRef !== undefined) {
          const storeRef = patch.storeRef?.trim();
          next.storeRef = storeRef ? storeRef : undefined;
        }
        persist(next);
        return next;
      });
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{
        auth,
        loading,
        logout,
        addRepo,
        removeRepo,
        setCurrentRepo,
        updateIntegrations,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/**
 * Build authorization headers from localStorage auth.
 * Use this in API route client-side calls.
 */
export function buildAuthHeaders(
  auth: KodyAuth | null,
): Record<string, string> {
  return buildKodyAuthHeaders(auth);
}
