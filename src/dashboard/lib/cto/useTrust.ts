"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern cto-trust-client
 * @ai-summary TanStack Query binding for the /trust page. Reads the full trust
 *   ledger (GET /api/kody/cto/trust) AND the duty roster (so each staff group
 *   can show the duties that run as it), then projects both through the pure
 *   `summarizeTrust` into per-staff view rows.
 *
 *   Exposes `setTrust({ staff, action, op })` — a mutation over POST
 *   /api/kody/cto/trust that applies reset / graduate / degrade and invalidates
 *   the trust query so the page reflects the new autonomy immediately.
 *
 *   Auth-scoped query keys (owner/repo): the ledger is per-repo. TTL ≥ 60s per
 *   CLAUDE.md rate-limit rule; the mutation invalidates on success.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth-context";
import { kodyApi } from "../api";
import {
  CTO_DECISIONS_MANIFEST_VERSION,
  type CtoDecisionLogEntry,
  type CtoDecisionsManifest,
} from "./decisions";
import {
  summarizeTrust,
  type TrustOp,
  type TrustStaffView,
} from "./trust-ops";

export const trustQueryKey = (owner?: string, repo?: string) =>
  ["cto-trust", owner ?? "", repo ?? ""] as const;

export interface UseTrustResult {
  /** Per-staff view rows (auto-first), or [] while loading. */
  groups: TrustStaffView[];
  /** Recent decision log (most recent last), bounded server-side. */
  log: CtoDecisionLogEntry[];
  isLoading: boolean;
  error: Error | null;
  /** Apply one trust override; resolves once the ledger write lands. */
  setTrust: (input: {
    staff: string;
    action: string;
    op: TrustOp;
  }) => Promise<void>;
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

  // Reuse the duties list (its own cache) only to map duty → staff.
  const dutiesQuery = useQuery({
    queryKey: ["duties", auth?.owner, auth?.repo],
    queryFn: () => kodyApi.duties.list(),
    enabled,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (input: { staff: string; action: string; op: TrustOp }) =>
      kodyApi.cto.setTrust({
        ...input,
        ...(auth?.user?.login ? { actorLogin: auth.user.login } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const groups = useMemo<TrustStaffView[]>(() => {
    if (!trustQuery.data) return [];
    const manifest: CtoDecisionsManifest = {
      version: CTO_DECISIONS_MANIFEST_VERSION,
      staff: trustQuery.data.staff,
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
