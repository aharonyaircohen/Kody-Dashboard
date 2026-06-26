"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern capability-trust-client
 * @ai-summary TanStack Query binding for the /trust page. Reads the capability-keyed
 *   trust ledger (GET /api/kody/cto/trust, backed by a Kody state repo file) AND the
 *   capability roster (to show the agent identity each capability runs as), then projects both
 *   through the pure `summarizeTrust`.
 *
 *   Exposes `setTrust({ capability, op })` — a mutation over POST
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
  type TrustCapabilityView,
  type TrustManifest,
  type TrustOp,
} from "./trust-state";

export const trustQueryKey = (owner?: string, repo?: string) =>
  ["cto-trust", owner ?? "", repo ?? ""] as const;

export interface UseTrustResult {
  /** Per-capability view rows (auto-first), or [] while loading. */
  groups: TrustCapabilityView[];
  /** Recent decision log (most recent last), bounded server-side. */
  log: TrustDecisionLogEntry[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  /** Refresh trust stats and the capability roster used to label them. */
  refetch: () => Promise<void>;
  /** Apply one whole-capability trust override; resolves once the write lands. */
  setTrust: (input: { capability: string; op: TrustOp }) => Promise<void>;
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

  // Reuse the capabilities list only to map capability → agent identity.
  const capabilitiesQuery = useQuery({
    queryKey: ["capabilities", auth?.owner, auth?.repo],
    queryFn: () => kodyApi.capabilities.list(),
    enabled,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (input: { capability: string; op: TrustOp }) =>
      kodyApi.cto.setTrust({
        ...input,
        ...(auth?.user?.login ? { actorLogin: auth.user.login } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const groups = useMemo<TrustCapabilityView[]>(() => {
    if (!trustQuery.data) return [];
    const manifest: TrustManifest = {
      version: TRUST_MANIFEST_VERSION,
      capabilities: trustQuery.data.capabilities,
      log: trustQuery.data.log,
    };
    const capabilityLinks = (capabilitiesQuery.data ?? []).map((d) => ({
      slug: d.slug,
      agent: d.agent ?? null,
    }));
    return summarizeTrust(manifest, capabilityLinks);
  }, [trustQuery.data, capabilitiesQuery.data]);

  return {
    groups,
    log: trustQuery.data?.log ?? [],
    isLoading: trustQuery.isLoading,
    isFetching: trustQuery.isFetching || capabilitiesQuery.isFetching,
    error: (trustQuery.error as Error | null) ?? null,
    refetch: async () => {
      await Promise.all([trustQuery.refetch(), capabilitiesQuery.refetch()]);
    },
    setTrust: async (input) => {
      await mutation.mutateAsync(input);
    },
    isMutating: mutation.isPending,
  };
}
