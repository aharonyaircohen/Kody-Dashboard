/**
 * @fileType hook
 * @domain kody
 * @pattern use-operators
 * @ai-summary Reads/writes the connected repo's operator list
 *   (`github.operators`) — the logins recommendation duties @-mention so
 *   their comments route into the inbox. Self-contained fetch + mutate over
 *   `kodyApi.company.operators`; callers get the list, loading/saving flags,
 *   and add/remove/save helpers. The list is the company's explicit choice,
 *   so there is no auto-fill here — `add(login)` is always an intentional act.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { kodyApi } from "../api";
import { useAuth } from "../auth-context";

function normalize(raw: readonly string[]): string[] {
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

export interface UseOperators {
  operators: string[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Whether the current user is already in the list (case-insensitive). */
  meIncluded: boolean;
  /** The signed-in user's login, for an "add me" affordance. */
  meLogin: string | undefined;
  add: (login: string) => Promise<void>;
  remove: (login: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function useOperators(): UseOperators {
  const { auth } = useAuth();
  const meLogin = auth?.user.login;

  const [operators, setOperators] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOperators(await kodyApi.company.operators.get());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load operators");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (next: string[]) => {
      setSaving(true);
      setError(null);
      try {
        const saved = await kodyApi.company.operators.set(
          normalize(next),
          meLogin,
        );
        setOperators(saved);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save operators");
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [meLogin],
  );

  const add = useCallback(
    (login: string) => save([...operators, login]),
    [operators, save],
  );

  const remove = useCallback(
    (login: string) =>
      save(operators.filter((o) => o.toLowerCase() !== login.toLowerCase())),
    [operators, save],
  );

  const meIncluded =
    !!meLogin &&
    operators.some((o) => o.toLowerCase() === meLogin.toLowerCase());

  return {
    operators,
    loading,
    saving,
    error,
    meIncluded,
    meLogin,
    add,
    remove,
    reload,
  };
}
