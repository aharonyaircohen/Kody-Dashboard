/**
 * @fileType hook
 * @domain vault
 * @pattern vault-status
 * @ai-summary Reports whether the secrets vault can actually be read for the
 *   connected repo. The vault API already returns the real failure
 *   (`vault_read_failed` when the master key can't decrypt the blob,
 *   `vault_not_configured` when KODY_MASTER_KEY is unset) — most callers throw
 *   that away and show "not configured". This hook keeps the raw error so the
 *   UI can present WHY a vault-backed feature (Fly previews, runners, Brain)
 *   is unavailable instead of going silent.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth, buildAuthHeaders } from "../auth-context";

export interface VaultStatus {
  isLoading: boolean;
  /** True when the vault exists but the dashboard could not read it. */
  failed: boolean;
  /** Machine code, e.g. "vault_read_failed" / "vault_not_configured". */
  code: string | null;
  /** Raw server error message — surfaced verbatim so nothing stays hidden. */
  message: string | null;
}

export function useVaultStatus(): VaultStatus {
  const { auth } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["vault-status", auth?.owner, auth?.repo],
    enabled: !!auth,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<{
      code: string | null;
      message: string | null;
    }> => {
      const res = await fetch("/api/kody/secrets", {
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(auth),
        },
      });
      if (res.ok) return { code: null, message: null };
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      return {
        code: json.error ?? `http_${res.status}`,
        message: json.message ?? json.error ?? `HTTP ${res.status}`,
      };
    },
  });

  return {
    isLoading,
    failed: !!data?.code,
    code: data?.code ?? null,
    message: data?.message ?? null,
  };
}
