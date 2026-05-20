"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern cto-decisions-client
 * @ai-summary TanStack Query binding over GET /api/kody/cto/decision.
 *   Exposes the latest verdict per `${taskNumber}:${action}` plus a
 *   typed lookup so the inbox can show a verdict badge instead of
 *   Approve/Reject once a recommendation was decided on any device.
 *
 *   Auth-scoped key (owner/repo) — the ledger is per-repo, same as the
 *   inbox gist. TTL ≥ 60s per CLAUDE.md rate-limit rule; `invalidate()`
 *   is called right after a local decide so the badge flips immediately.
 */
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth-context";
import { kodyApi } from "../api";
import { ctoDecisionKey } from "./decisions";
import type { CtoActionable } from "./recommendation";

export const ctoDecisionsQueryKey = (owner?: string, repo?: string) =>
  ["cto-decisions", owner ?? "", repo ?? ""] as const;

type Verdict = "approve" | "reject" | "dismiss";

export interface UseCtoDecisionsResult {
  /** Latest verdict for a recommendation, or null if undecided. */
  verdictFor: (taskNumber: number, action: CtoActionable) => Verdict | null;
  invalidate: () => Promise<void>;
}

export function useCtoDecisions(): UseCtoDecisionsResult {
  const { auth } = useAuth();
  const qc = useQueryClient();
  const key = ctoDecisionsQueryKey(auth?.owner, auth?.repo);
  const enabled = !!auth;

  const query = useQuery<Record<string, Verdict>>({
    queryKey: key,
    queryFn: async () => (await kodyApi.cto.decisions()).decided,
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: true,
  });

  const decided = useMemo(() => query.data ?? {}, [query.data]);

  return {
    verdictFor: (taskNumber, action) =>
      decided[ctoDecisionKey(taskNumber, action)] ?? null,
    invalidate: () => qc.invalidateQueries({ queryKey: key }),
  };
}
