/**
 * @fileType context
 * @domain kody
 *
 * Auth context for reading stored GitHub credentials from localStorage.
 *
 * Multi-repo: stores a list of repos under `repos[]` and a `currentRepoIndex`.
 * The flat fields (owner/repo/token/repoUrl) always reflect the *current* repo
 * for backward compatibility — every consumer (api.ts, utils.ts, etc.) keeps
 * reading them as before. Switching repos rewrites the flat fields and
 * triggers a full page reload to clear React Query cache and in-flight polls.
 *
 * On login: credentials stored in localStorage as JSON.
 * On logout: credentials cleared from localStorage.
 *
 * API routes read the token from a custom header set by the client
 * (x-kody-token, x-kody-owner, x-kody-repo) instead of env vars.
 */
"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

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
}

interface AuthContextValue {
  auth: KodyAuth | null;
  loading: boolean;
  logout: () => void;
  /** Push a new repo entry. Does not switch to it — caller should call setCurrentRepo if desired. */
  addRepo: (entry: Omit<KodyRepoEntry, "addedAt" | "isLogin">) => void;
  /** Remove a repo by index. Removing the current repo falls back to index 0. Removing the only repo logs out. */
  removeRepo: (index: number) => void;
  /** Switch the active repo. Triggers a full page reload to clear React Query cache. */
  setCurrentRepo: (index: number) => void;
  /**
   * Update the per-browser integration fields (brain, vercelBypassSecret).
   * Pass `null` to clear a field, omit it to leave it unchanged.
   */
  updateIntegrations: (patch: {
    brain?: { url: string; apiKey: string } | null;
    vercelBypassSecret?: string | null;
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
  const a = raw as Partial<KodyAuth> & { repos?: KodyRepoEntry[]; currentRepoIndex?: number };

  if (!a.owner || !a.repo || !a.token || !a.user) return null;

  // Already migrated.
  if (Array.isArray(a.repos) && a.repos.length > 0 && typeof a.currentRepoIndex === "number") {
    const idx = Math.min(Math.max(0, a.currentRepoIndex), a.repos.length - 1);
    const cur = a.repos[idx];
    // Trust repos[idx] as source of truth — repaint flat fields if drifted.
    return {
      ...(a as KodyAuth),
      currentRepoIndex: idx,
      repoUrl: cur.repoUrl,
      owner: cur.owner,
      repo: cur.repo,
      token: cur.token,
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
  };
}

function persist(next: KodyAuth): void {
  localStorage.setItem("kody_auth", JSON.stringify(next));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<KodyAuth | null>(null);
  const [loading, setLoading] = useState(true);

  // Load auth from localStorage on mount, migrating legacy shape if needed.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("kody_auth");
      if (stored) {
        const parsed = JSON.parse(stored);
        const migrated = migrateAuth(parsed);
        if (migrated) {
          setAuth(migrated);
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
    setAuth(null);
    window.location.href = "/login";
  }, []);

  const addRepo = useCallback(
    (entry: Omit<KodyRepoEntry, "addedAt" | "isLogin">) => {
      setAuth((prev) => {
        if (!prev) return prev;
        const ownerLc = entry.owner.toLowerCase();
        const repoLc = entry.repo.toLowerCase();
        // Dedupe: if the same owner/repo already exists, replace its token instead.
        const existingIdx = prev.repos.findIndex(
          (r) => r.owner.toLowerCase() === ownerLc && r.repo.toLowerCase() === repoLc,
        );
        let nextRepos: KodyRepoEntry[];
        if (existingIdx >= 0) {
          nextRepos = prev.repos.map((r, i) =>
            i === existingIdx ? { ...r, token: entry.token, repoUrl: entry.repoUrl } : r,
          );
        } else {
          nextRepos = [
            ...prev.repos,
            { ...entry, addedAt: Date.now(), isLogin: false },
          ];
        }
        const next: KodyAuth = { ...prev, repos: nextRepos };
        persist(next);
        return next;
      });
    },
    [],
  );

  const removeRepo = useCallback(
    (index: number) => {
      setAuth((prev) => {
        if (!prev) return prev;
        if (index < 0 || index >= prev.repos.length) return prev;

        const removing = prev.repos[index];
        if (removing.isLogin) {
          // Removing the login repo == logout.
          localStorage.removeItem("kody_auth");
          window.location.href = "/login";
          return null;
        }

        const nextRepos = prev.repos.filter((_, i) => i !== index);
        if (nextRepos.length === 0) {
          // Shouldn't happen (login is non-removable), but bail to logout.
          localStorage.removeItem("kody_auth");
          window.location.href = "/login";
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
        // If we switched the current repo, force a reload to clear caches.
        if (index === prev.currentRepoIndex) {
          window.location.reload();
        }
        return next;
      });
    },
    [],
  );

  const setCurrentRepo = useCallback((index: number) => {
    setAuth((prev) => {
      if (!prev) return prev;
      if (index < 0 || index >= prev.repos.length) return prev;
      if (index === prev.currentRepoIndex) return prev;
      const cur = prev.repos[index];
      const next: KodyAuth = {
        ...prev,
        currentRepoIndex: index,
        repoUrl: cur.repoUrl,
        owner: cur.owner,
        repo: cur.repo,
        token: cur.token,
      };
      persist(next);
      // Full reload — wipes React Query cache, in-flight polls, chat state.
      window.location.href = "/";
      return next;
    });
  }, []);

  const updateIntegrations = useCallback(
    (patch: {
      brain?: { url: string; apiKey: string } | null;
      vercelBypassSecret?: string | null;
    }) => {
      setAuth((prev) => {
        if (!prev) return prev;
        const next: KodyAuth = { ...prev };
        if (patch.brain !== undefined) {
          next.brain = patch.brain === null ? undefined : patch.brain;
        }
        if (patch.vercelBypassSecret !== undefined) {
          next.vercelBypassSecret =
            patch.vercelBypassSecret === null ? undefined : patch.vercelBypassSecret;
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
export function buildAuthHeaders(auth: KodyAuth | null): Record<string, string> {
  if (!auth) return {};
  return {
    "x-kody-token": auth.token,
    "x-kody-owner": auth.owner,
    "x-kody-repo": auth.repo,
  };
}
