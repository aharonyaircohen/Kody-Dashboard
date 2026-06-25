"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern trust-manager
 * @ai-summary The /trust page body. One row per agentResponsibility (whole-agentResponsibility trust): mode
 *   (Ask / Auto), approval + rejection tallies, progress toward graduation, and
 *   always-available overrides — Graduate (force Auto now, works from scratch),
 *   De-graduate (kill switch back to Ask), Reset (wipe). A compact
 *   recent-decision log sits at the bottom. State + mutations come from
 *   `useTrust`.
 *
 *   Trust is keyed per AGENT_RESPONSIBILITY (not agentIdentity, not per action), so the controls are
 *   present for every agentResponsibility in the roster even before it has any history.
 */
import { useMemo } from "react";
import {
  CheckCircle2,
  ChevronUp,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { Badge } from "@dashboard/ui/badge";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { TRUST_GRADUATION_THRESHOLD } from "../cto/trust-state";
import { useTrust } from "../cto/useTrust";
import type { TrustAgentResponsibilityView, TrustOp } from "../cto/trust-state";

function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="h-1.5 w-full rounded-full bg-white/10" aria-hidden>
      <div
        className="h-full rounded-full bg-emerald-400/80 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function AgentResponsibilityRow({
  agentResponsibility,
  busy,
  onOp,
}: {
  agentResponsibility: TrustAgentResponsibilityView;
  busy: boolean;
  onOp: (op: TrustOp) => void;
}) {
  const isAuto = agentResponsibility.mode === "auto";
  return (
    <Card className="border-white/[0.08] bg-white/[0.02]">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-base font-semibold text-white/90">
              {agentResponsibility.agentResponsibility}
            </span>
            {agentResponsibility.agent && (
              <span className="text-body-xs text-muted-foreground">
                runs as{" "}
                <code className="rounded bg-white/[0.06] px-1 py-0.5 text-white/70">
                  {agentResponsibility.agent}
                </code>
              </span>
            )}
            <Badge variant={isAuto ? "default" : "secondary"} className="gap-1">
              {isAuto && <ShieldCheck className="h-3 w-3" />}
              {isAuto ? "Auto" : "Ask"}
            </Badge>
            <span className="flex items-center gap-2 text-body-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-400/80" />
                {agentResponsibility.approvals}
              </span>
              <span className="inline-flex items-center gap-1">
                <XCircle className="h-3 w-3 text-rose-400/80" />
                {agentResponsibility.rejections}
              </span>
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar value={agentResponsibility.progress} />
            <span className="shrink-0 text-body-xs tabular-nums text-muted-foreground">
              {isAuto
                ? "graduated"
                : `${agentResponsibility.consecutiveApprovals}/${TRUST_GRADUATION_THRESHOLD}`}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isAuto ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onOp("degrade")}
            >
              De-graduate
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onOp("graduate")}
              title={`Set "${agentResponsibility.agentResponsibility}" to Auto now`}
            >
              <ChevronUp className="h-4 w-4" />
              Set Auto
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={
              busy ||
              (!agentResponsibility.hasHistory &&
                agentResponsibility.mode === "ask")
            }
            title={`Reset trust for ${agentResponsibility.agentResponsibility}`}
            onClick={() => {
              if (
                window.confirm(
                  `Reset all trust for "${agentResponsibility.agentResponsibility}"? This wipes its approvals, rejections, and streak.`,
                )
              ) {
                onOp("reset");
              }
            }}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentLog({ log }: { log: ReturnType<typeof useTrust>["log"] }) {
  const recent = useMemo(() => [...log].slice(-15).reverse(), [log]);
  if (recent.length === 0) return null;
  return (
    <Card className="border-white/[0.08] bg-white/[0.02]">
      <CardContent className="p-4">
        <p className="mb-2 text-body-sm font-semibold text-white/90">
          Recent decisions
        </p>
        <ul className="space-y-1.5">
          {recent.map((e, i) => (
            <li
              key={`${e.taskNumber}-${e.at}-${i}`}
              className="flex items-center gap-2 text-body-xs text-muted-foreground"
            >
              <Badge
                variant={
                  e.decision === "approve"
                    ? "default"
                    : e.decision === "reject"
                      ? "destructive"
                      : "secondary"
                }
              >
                {e.decision}
              </Badge>
              <code className="text-white/70">{e.agentResponsibility}</code>
              {e.action && (
                <>
                  <span>·</span>
                  <code className="text-white/70">{e.action}</code>
                </>
              )}
              <span>·</span>
              <span>#{e.taskNumber}</span>
              <span className="ml-auto tabular-nums">
                {new Date(e.at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function TrustManager() {
  const { groups, log, isLoading, error, setTrust, isMutating } = useTrust();

  return (
    <div className="h-full overflow-y-auto bg-black/95 text-white/90">
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-6 md:px-6">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-h4 font-semibold text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-400/80" />
            Trust
          </h1>
          <p className="text-body-sm text-muted-foreground">
            Every agentResponsibility starts in <strong>Ask</strong> mode and
            needs your approval before it acts. After{" "}
            {TRUST_GRADUATION_THRESHOLD} clean approvals it graduates to{" "}
            <strong>Auto</strong> and the engine runs it on its own; one reject
            sends it back to Ask. Grant or revoke Auto for any
            agentResponsibility here.
          </p>
        </header>

        {error && (
          <Card className="border-destructive/40 bg-destructive/10">
            <CardContent className="p-4 text-body-sm text-destructive-foreground">
              Couldn&apos;t load the trust ledger: {error.message}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <p className="text-body-sm text-muted-foreground">Loading trust…</p>
        ) : groups.length === 0 ? (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-6 text-center text-body-sm text-muted-foreground">
              No agentResponsibilities found for this repo.
            </CardContent>
          </Card>
        ) : (
          groups.map((g) => (
            <AgentResponsibilityRow
              key={g.agentResponsibility}
              agentResponsibility={g}
              busy={isMutating}
              onOp={(op) =>
                void setTrust({
                  agentResponsibility: g.agentResponsibility,
                  op,
                })
              }
            />
          ))
        )}

        <RecentLog log={log} />
      </div>
    </div>
  );
}
