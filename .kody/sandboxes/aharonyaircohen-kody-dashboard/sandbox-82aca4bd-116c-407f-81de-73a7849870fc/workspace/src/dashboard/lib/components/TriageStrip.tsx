/**
 * @fileType component
 * @domain kody
 * @pattern triage-strip
 * @ai-summary Renders the dashboard's "what should I look at first?" strip:
 *   a ranked, time-decayed list pulled from the same hooks the source cards
 *   already poll. Items can be dismissed (4h TTL, localStorage) and the
 *   action button on a row both fires the action AND dismisses the row, so
 *   the strip self-clears as the operator works through it.
 */
"use client";

import Link from "next/link";
import { Loader2, X } from "lucide-react";

import { Card } from "@dashboard/ui/card";
import { Button } from "@dashboard/ui/button";
import {
  useTriageStrip,
  type TriageItem,
  type TriageSeverity,
} from "../hooks/useTriageStrip";
import { cn } from "../utils";
import { autoDirProps } from "../text-direction";

const DOT: Record<TriageSeverity, string> = {
  5: "bg-rose-500",
  4: "bg-rose-400",
  3: "bg-rose-300",
  2: "bg-amber-400",
  1: "bg-amber-300/70",
};

const ROW_TINT: Record<TriageSeverity, string> = {
  5: "border-l-2 border-rose-500/60",
  4: "border-l-2 border-rose-500/50",
  3: "border-l-2 border-rose-400/40",
  2: "border-l-2 border-amber-500/40",
  1: "border-l-2 border-amber-400/30",
};

const SEVERITY_LABEL: Record<TriageSeverity, string> = {
  5: "P0",
  4: "P1",
  3: "P2",
  2: "P3",
  1: "P4",
};

export function TriageStrip() {
  const { items, dismiss } = useTriageStrip(4);
  if (items.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
          Triage
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {items.length} need attention · dismiss lasts 4h
        </span>
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-white/[0.04]">
          {items.map((it) => (
            <TriageRow key={it.id} item={it} onDismiss={() => dismiss(it.id)} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function TriageRow({
  item,
  onDismiss,
}: {
  item: TriageItem;
  onDismiss: () => void;
}) {
  const external = item.href?.startsWith("http");
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.04]",
        ROW_TINT[item.severity],
      )}
    >
      <span
        className={cn("w-2 h-2 rounded-full shrink-0", DOT[item.severity])}
        title={`Severity ${SEVERITY_LABEL[item.severity]}`}
      />
      <div className="min-w-0 flex-1">
        {item.href ? (
          <Link
            href={item.href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className="text-sm truncate block hover:underline text-start"
            {...autoDirProps}
          >
            {item.title}
          </Link>
        ) : (
          <span {...autoDirProps} className="text-sm truncate block text-start">
            {item.title}
          </span>
        )}
        {item.detail ? (
          <span className="text-xs text-muted-foreground truncate block">
            {item.detail}
          </span>
        ) : null}
      </div>
      {item.action ? (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px] gap-1 shrink-0"
          disabled={item.action.pending}
          onClick={() => {
            item.action!.onClick();
            onDismiss();
          }}
          title={`${item.action.label} — and dismiss for 4h`}
        >
          {item.action.pending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : null}
          {item.action.label}
        </Button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        className="p-1 text-muted-foreground hover:text-foreground shrink-0"
        title="Dismiss for 4 hours"
        aria-label="Dismiss triage item"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}
