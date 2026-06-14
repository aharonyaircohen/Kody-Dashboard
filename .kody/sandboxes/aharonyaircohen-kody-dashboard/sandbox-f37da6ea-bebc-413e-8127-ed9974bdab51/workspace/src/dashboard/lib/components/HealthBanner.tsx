"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern health-banner
 * @ai-summary The upstream-health banner at the top of the Activity view.
 *   Answers "can runs even start?" — surfacing the silent blockers that
 *   happen BEFORE a run exists (GitHub Actions outage, a throttled token, a
 *   dead model key, failing webhooks). Collapsed it's a one-line red/amber/
 *   green pill with a count; expanded it lists each probed signal with a
 *   plain-language detail and optional link. Polls every 30s via useHealth.
 */
import { useState } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { cn } from "../utils";
import { useHealth } from "../hooks/useHealth";
import { countByLevel } from "../health/rollup";
import type { HealthLevel, HealthSignal } from "../health/types";

const LEVEL_STYLES: Record<
  HealthLevel,
  { border: string; bg: string; text: string; dot: string }
> = {
  ok: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/[0.05]",
    text: "text-emerald-200",
    dot: "bg-emerald-400",
  },
  degraded: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/[0.07]",
    text: "text-amber-200",
    dot: "bg-amber-400",
  },
  down: {
    border: "border-rose-500/40",
    bg: "bg-rose-500/[0.07]",
    text: "text-rose-200",
    dot: "bg-rose-400",
  },
};

function LevelIcon({
  level,
  className,
}: {
  level: HealthLevel;
  className?: string;
}) {
  if (level === "down") return <XCircle className={className} />;
  if (level === "degraded") return <AlertTriangle className={className} />;
  return <CheckCircle2 className={className} />;
}

function summaryText(
  level: HealthLevel,
  counts: Record<HealthLevel, number>,
): string {
  if (level === "ok") return "All systems healthy";
  const parts: string[] = [];
  if (counts.down > 0) parts.push(`${counts.down} down`);
  if (counts.degraded > 0) parts.push(`${counts.degraded} degraded`);
  return parts.join(" · ") || "Degraded";
}

function SignalRow({ sig }: { sig: HealthSignal }) {
  const st = LEVEL_STYLES[sig.level];
  return (
    <li className="flex items-start gap-2.5 px-3 py-2">
      <LevelIcon
        level={sig.level}
        className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", st.text)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-white/85">{sig.label}</span>
          {sig.url && (
            <a
              href={sig.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center text-white/35 hover:text-white"
              aria-label={`Open ${sig.label} reference`}
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-white/55">
          {sig.detail}
        </div>
      </div>
    </li>
  );
}

export function HealthBanner() {
  const { data, isLoading } = useHealth();
  const [open, setOpen] = useState(false);

  if (isLoading && !data) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-white/45">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking system health…
      </div>
    );
  }
  if (!data) return null;

  const st = LEVEL_STYLES[data.level];
  const counts = countByLevel(data.signals);

  return (
    <div
      className={cn("mb-4 overflow-hidden rounded-lg border", st.border, st.bg)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
        aria-expanded={open}
      >
        {data.level === "ok" ? (
          <ShieldCheck className={cn("h-4 w-4", st.text)} />
        ) : (
          <LevelIcon level={data.level} className={cn("h-4 w-4", st.text)} />
        )}
        <span className={cn("text-xs font-semibold", st.text)}>
          {summaryText(data.level, counts)}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[10px] text-white/40">
          {data.signals.length} checks
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      {open && (
        <ul className="divide-y divide-white/[0.05] border-t border-white/[0.06]">
          {data.signals.map((sig) => (
            <SignalRow key={sig.id} sig={sig} />
          ))}
        </ul>
      )}
    </div>
  );
}
