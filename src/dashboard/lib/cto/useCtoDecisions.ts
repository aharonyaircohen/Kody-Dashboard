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
 *   `verdictFor` accepts an optional `sinceIso` (the inbox entry's
 *   `sentAt`) and returns `null` when the latest decision pre-dates that
 *   message — that way a dismiss the operator made yesterday on the
 *   `(PR#1574, sync)` pair doesn't silently stamp today's fresh sync
 *   recommendation as Dismissed. Without this gate, every periodic
 *   re-post of a sync/fix-ci/resolve rec on the same PR is inherits the
 *   prior verdict forever — that's the "auto-dismissed" bug.
 *
 *   Auth-scoped key (owner/repo) — the ledger is per-repo, same as the
 *   inbox gist. TTL ≥ 60s per CLAUDE.md rate-limit rule; `invalidate()`
 *   is called right after a local decide so the badge flips immediately.
 */
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth-context";
import { kodyApi } from "../api";
import { ctoDecisionKey, type CtoLatestDecision } from "./decisions";
import type { CtoActionable } from "./recommendation";

export const ctoDecisionsQueryKey = (owner?: string, repo?: string) =>
  ["cto-decisions", owner ?? "", repo ?? ""] as const;

type Verdict = "approve" | "reject" | "dismiss";

export interface UseCtoDecisionsResult {
  /**
   * Latest verdict for a recommendation, or null if undecided.
   * Pass `sinceIso` (inbox entry's `sentAt`) so a verdict recorded
   * BEFORE this rec was posted is not applied to it.
   */
  verdictFor: (
    taskNumber: number,
    action: CtoActionable,
    sinceIso?: string,
  ) => Verdict | null;
  invalidate: () => Promise<void>;
}

export function useCtoDecisions(): UseCtoDecisionsResult {
  const { auth } = useAuth();
  const qc = useQueryClient();
  const key = ctoDecisionsQueryKey(auth?.owner, auth?.repo);
  const enabled = !!auth;

  const query = useQuery<Record<string, CtoLatestDecision>>({
    queryKey: key,
    queryFn: async () => (await kodyApi.cto.decisions()).decided,
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: true,
  });

  const decided = useMemo(() => query.data ?? {}, [query.data]);

  return {
    verdictFor: (taskNumber, action, sinceIso) => {
      const v = decided[ctoDecisionKey(taskNumber, action)];
      if (!v) return null;
      if (sinceIso) {
        const since = Date.parse(sinceIso);
        const at = Date.parse(v.at);
        // Only treat the verdict as binding when it was recorded AFTER the
        // rec arrived. Earlier verdicts referred to a previous rec for the
        // same (task, action) pair, not this one. A NaN parse (malformed
        // timestamp) fails open — keep the old behaviour and apply.
        if (!Number.isNaN(since) && !Number.isNaN(at) && at < since) {
          return null;
        }
      }
      return v.decision;
    },
    invalidate: () => qc.invalidateQueries({ queryKey: key }),
  };
}
