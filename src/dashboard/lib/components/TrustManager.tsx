"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern trust-manager
 * @ai-summary The /trust page body. Renders the staff trust ledger grouped by
 *   staff persona: each action shows its mode (Ask / Auto), approval +
 *   rejection tallies, and progress toward graduation, with operator overrides
 *   — Graduate (force Auto now), De-graduate (kill switch back to Ask), and
 *   Reset (wipe the action's trust). A compact recent-decision log sits at the
 *   bottom. All state + mutations come from `useTrust`.
 *
 *   Why this exists: Phase 1 only *recorded* trust; there was no surface to see
 *   how close a duty's staff is to acting on its own, or to grant/revoke that
 *   autonomy by hand. This is that surface.
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
import { Card, CardContent, CardHeader, CardTitle } from "@dashboard/ui/card";
import { CTO_GRADUATION_THRESHOLD } from "../cto/decisions";
import { useTrust } from "../cto/useTrust";
import type { TrustActionView, TrustStaffView } from "../cto/trust-ops";

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

function ActionRow({
  staff,
  action,
  busy,
  onOp,
}: {
  staff: string;
  action: TrustActionView;
  busy: boolean;
  onOp: (op: "reset" | "graduate" | "degrade") => void;
}) {
  const isAuto = action.mode === "auto";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <code className="text-body-sm font-semibold text-white/90">
            {action.action}
          </code>
          <Badge variant={isAuto ? "default" : "secondary"}>
            {isAuto ? "Auto" : "Ask"}
          </Badge>
          <span className="flex items-center gap-2 text-body-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-400/80" />
              {action.approvals}
            </span>
            <span className="inline-flex items-center gap-1">
              <XCircle className="h-3 w-3 text-rose-400/80" />
              {action.rejections}
            </span>
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={action.progress} />
          <span className="shrink-0 text-body-xs tabular-nums text-muted-foreground">
            {isAuto
              ? "graduated"
              : `${action.consecutiveApprovals}/${CTO_GRADUATION_THRESHOLD}`}
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
            title={`Force "${action.action}" to Auto now`}
          >
            <ChevronUp className="h-4 w-4" />
            Graduate
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          title={`Reset trust for ${staff} · ${action.action}`}
          onClick={() => {
            if (
              window.confirm(
                `Reset all trust for "${staff} · ${action.action}"? This wipes its approvals, rejections, and streak.`,
              )
            ) {
              onOp("reset");
            }
          }}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function StaffCard({
  group,
  busy,
  onOp,
}: {
  group: TrustStaffView;
  busy: boolean;
  onOp: (action: string, op: "reset" | "graduate" | "degrade") => void;
}) {
  return (
    <Card className="border-white/[0.08] bg-white/[0.02]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-body-base text-white/90">
            {group.staff}
          </CardTitle>
          {group.hasAuto && (
            <Badge variant="default" className="gap-1">
              <ShieldCheck className="h-3 w-3" />
              autonomous
            </Badge>
          )}
          {group.duties.length > 0 && (
            <span className="text-body-xs text-muted-foreground">
              runs:{" "}
              {group.duties.map((d) => (
                <code
                  key={d}
                  className="mx-0.5 rounded bg-white/[0.06] px-1 py-0.5 text-white/70"
                >
                  {d}
                </code>
              ))}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {group.actions.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            No recommendations decided yet — this staff earns trust as you
            approve its recommendations in the inbox.
          </p>
        ) : (
          group.actions.map((a) => (
            <ActionRow
              key={a.action}
              staff={group.staff}
              action={a}
              busy={busy}
              onOp={(op) => onOp(a.action, op)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function RecentLog({
  log,
}: {
  log: ReturnType<typeof useTrust>["log"];
}) {
  const recent = useMemo(() => [...log].slice(-15).reverse(), [log]);
  if (recent.length === 0) return null;
  return (
    <Card className="border-white/[0.08] bg-white/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="text-body-base text-white/90">
          Recent decisions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {recent.map((e, i) => (
            <li
              key={`${e.taskNumber}-${e.action}-${e.at}-${i}`}
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
              <code className="text-white/70">{e.staff}</code>
              <span>·</span>
              <code className="text-white/70">{e.action}</code>
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
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-6">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-h4 font-semibold text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-400/80" />
            Trust
          </h1>
          <p className="text-body-sm text-muted-foreground">
            Every staff member starts in <strong>Ask</strong> mode and must get
            your approval before each action. After{" "}
            {CTO_GRADUATION_THRESHOLD} clean approvals of the same action it
            graduates to <strong>Auto</strong> and acts on its own; one reject
            sends it back to Ask. Override any of that here.
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
              No trust recorded yet. As you approve staff recommendations in the
              inbox, each staff member&apos;s actions appear here with their
              progress toward acting on their own.
            </CardContent>
          </Card>
        ) : (
          groups.map((g) => (
            <StaffCard
              key={g.staff}
              group={g}
              busy={isMutating}
              onOp={(action, op) =>
                void setTrust({ staff: g.staff, action, op })
              }
            />
          ))
        )}

        <RecentLog log={log} />
      </div>
    </div>
  );
}
