"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern trust-decisions-client
 * @ai-summary TanStack Query binding over GET /api/kody/cto/decision.
 *   Exposes the latest verdict per `${capability}:${taskNumber}:${action}` plus a
 *   typed lookup so the inbox can show a verdict badge instead of
 *   Approve/Reject once a recommendation was decided on any device.
 *
 *   `verdictFor` accepts an optional `sinceIso` (the inbox entry's
 *   `sentAt`) and returns `null` when the latest decision pre-dates that
 *   message — that way a dismiss the operator made yesterday on the
 *   `(PR#1574, sync)` pair doesn't silently stamp today's fresh sync
 *   recommendation as Dismissed.
 */
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth-context";
import { kodyApi } from "../api";
import { trustDecisionKey, type TrustLatestDecision } from "./trust-state";
import type { CtoActionable } from "./recommendation";

export const trustDecisionsQueryKey = (owner?: string, repo?: string) =>
  ["trust-decisions", owner ?? "", repo ?? ""] as const;

type Verdict = "approve" | "reject" | "dismiss";

export interface UseTrustDecisionsResult {
  /**
   * Latest verdict for a recommendation, or null if undecided.
   * Pass `sinceIso` (inbox entry's `sentAt`) so a verdict recorded
   * BEFORE this rec was posted is not applied to it.
   */
  verdictFor: (
    capability: string,
    taskNumber: number,
    action: CtoActionable,
    sinceIso?: string,
  ) => Verdict | null;
  invalidate: () => Promise<void>;
}

export function useTrustDecisions(): UseTrustDecisionsResult {
  const { auth } = useAuth();
  const qc = useQueryClient();
  const key = trustDecisionsQueryKey(auth?.owner, auth?.repo);
  const enabled = !!auth;

  const query = useQuery<Record<string, TrustLatestDecision>>({
    queryKey: key,
    queryFn: async () => (await kodyApi.cto.decisions()).decided,
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: true,
  });

  const decided = useMemo(() => query.data ?? {}, [query.data]);

  return {
    verdictFor: (capability, taskNumber, action, sinceIso) => {
      const v = decided[trustDecisionKey(capability, taskNumber, action)];
      if (!v) return null;
      if (sinceIso) {
        const since = Date.parse(sinceIso);
        const at = Date.parse(v.at);
        if (!Number.isNaN(since) && !Number.isNaN(at) && at < since) {
          return null;
        }
      }
      return v.decision;
    },
    invalidate: () => qc.invalidateQueries({ queryKey: key }),
  };
}
