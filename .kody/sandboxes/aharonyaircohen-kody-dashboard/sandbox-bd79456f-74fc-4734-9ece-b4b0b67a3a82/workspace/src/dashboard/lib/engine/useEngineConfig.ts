/**
 * @fileType hook
 * @domain engine
 * @pattern use-engine-config
 * @ai-summary Loads and patches the dashboard-editable slice of
 *   kody.config.json (quality commands, comment aliases, the `@kody` access
 *   gate, default branch) over `kodyApi.company.config`. Each consuming card
 *   edits one slice and calls `save(patch)`; the server returns the merged
 *   result, which becomes the new state — so cards never clobber each other.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { kodyApi, type EngineEditableConfig } from "../api";
import { useAuth } from "../auth-context";

export interface UseEngineConfig {
  config: EngineEditableConfig | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: (patch: Partial<EngineEditableConfig>) => Promise<void>;
  reload: () => Promise<void>;
}

export function useEngineConfig(): UseEngineConfig {
  const { auth } = useAuth();
  const actorLogin = auth?.user.login;

  const [config, setConfig] = useState<EngineEditableConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConfig(await kodyApi.company.config.get());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (patch: Partial<EngineEditableConfig>) => {
      setSaving(true);
      setError(null);
      try {
        setConfig(await kodyApi.company.config.patch(patch, actorLogin));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save config");
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [actorLogin],
  );

  return { config, loading, saving, error, save, reload };
}
