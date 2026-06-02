"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern duty-trust-client
 * @ai-summary TanStack Query binding for the /trust page. Reads the duty-keyed
 *   trust ledger (GET /api/kody/cto/trust, backed by a kody-state file) AND the
 *   duty roster (to show the persona each duty runs as), then projects both
 *   through the pure `summarizeTrust` into per-duty view rows.
 *
 *   Exposes `setTrust({ duty, action, op })` — a mutation over POST
 *   /api/kody/cto/trust (reset / graduate / degrade) that invalidates the trust
 *   query so the page reflects the new autonomy immediately.
 *
 *   Auth-scoped query keys (owner/repo): the ledger is per-repo. TTL ≥ 60s per
 *   CLAUDE.md rate-limit rule; the mutation invalidates on success.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth-context";
import { kodyApi } from "../api";
import {
  TRUST_MANIFEST_VERSION,
  summarizeTrust,
  type TrustDecisionLogEntry,
  type TrustDutyView,
  type TrustManifest,
  type TrustOp,
} from "./trust-state";

export const trustQueryKey = (owner?: string, repo?: string) =>
  ["cto-trust", owner ?? "", repo ?? ""] as const;

export interface UseTrustResult {
  /** Per-duty view rows (auto-first), or [] while loading. */
  groups: TrustDutyView[];
  /** Recent decision log (most recent last), bounded server-side. */
  log: TrustDecisionLogEntry[];
  isLoading: boolean;
  error: Error | null;
  /** Apply one whole-duty trust override; resolves once the write lands. */
  setTrust: (input: { duty: string; op: TrustOp }) => Promise<void>;
  /** True while a `setTrust` mutation is in flight. */
  isMutating: boolean;
}

export function useTrust(): UseTrustResult {
  const { auth } = useAuth();
  const qc = useQueryClient();
  const key = trustQueryKey(auth?.owner, auth?.repo);
  const enabled = !!auth;

  const trustQuery = useQuery({
    queryKey: key,
    queryFn: () => kodyApi.cto.trust(),
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: true,
  });

  // Reuse the duties list (its own cache) only to map duty → persona.
  const dutiesQuery = useQuery({
    queryKey: ["duties", auth?.owner, auth?.repo],
    queryFn: () => kodyApi.duties.list(),
    enabled,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (input: { duty: string; op: TrustOp }) =>
      kodyApi.cto.setTrust({
        ...input,
        ...(auth?.user?.login ? { actorLogin: auth.user.login } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const groups = useMemo<TrustDutyView[]>(() => {
    if (!trustQuery.data) return [];
    const manifest: TrustManifest = {
      version: TRUST_MANIFEST_VERSION,
      duties: trustQuery.data.duties,
      log: trustQuery.data.log,
    };
    const dutyLinks = (dutiesQuery.data ?? []).map((d) => ({
      slug: d.slug,
      staff: d.staff,
    }));
    return summarizeTrust(manifest, dutyLinks);
  }, [trustQuery.data, dutiesQuery.data]);

  return {
    groups,
    log: trustQuery.data?.log ?? [],
    isLoading: trustQuery.isLoading,
    error: (trustQuery.error as Error | null) ?? null,
    setTrust: async (input) => {
      await mutation.mutateAsync(input);
    },
    isMutating: mutation.isPending,
  };
}
