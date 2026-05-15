/**
 * @fileType component
 * @domain kody
 * @pattern goal-progress-ring
 * @ai-summary Compact donut ring + count for a goal's task completion. Visually distinct
 *   from per-task linear progress bars so it reads as a rollup, not as another task bar.
 */
"use client";

import { cn } from "../utils";
import type { GoalPaletteKey } from "../goal-palette";

interface GoalProgressRingProps {
  done: number;
  total: number;
  paletteKey?: GoalPaletteKey;
  className?: string;
}

// Tailwind JIT requires literal class names — keep the map explicit.
const RING_COLOR: Record<GoalPaletteKey, string> = {
  sky: "text-sky-400",
  emerald: "text-emerald-400",
  amber: "text-amber-400",
  rose: "text-rose-400",
  violet: "text-violet-400",
  indigo: "text-indigo-400",
  teal: "text-teal-400",
  fuchsia: "text-fuchsia-400",
};

export function GoalProgressRing({
  done,
  total,
  paletteKey,
  className,
}: GoalProgressRingProps) {
  if (total <= 0) {
    return (
      <span className={cn("text-xs text-muted-foreground shrink-0", className)}>
        empty
      </span>
    );
  }

  const pct = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const strokeColor = paletteKey ? RING_COLOR[paletteKey] : "text-emerald-400";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 shrink-0 tabular-nums",
        className,
      )}
      title={`${done} of ${total} done · ${pct}%`}
      aria-label={`${done} of ${total} tasks done, ${pct} percent`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        className={cn("shrink-0", strokeColor)}
        aria-hidden="true"
      >
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="opacity-20"
        />
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 8 8)"
          style={{ transition: "stroke-dashoffset 500ms ease-out" }}
        />
      </svg>
      <span className="text-xs text-muted-foreground">
        {done}/{total}
      </span>
    </span>
  );
}
