"use client";

import { CheckCircle2, Loader2, Zap } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import type { RunMode } from "../cto/run-mode";
import { cn } from "../utils";

export function RunModeBadge({
  mode,
  capabilityCount,
}: {
  mode: RunMode;
  capabilityCount?: number;
}) {
  const Icon = mode === "auto" ? Zap : CheckCircle2;
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border",
        mode === "auto"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
          : "border-amber-500/25 bg-amber-500/10 text-amber-300",
      )}
      title={runModeTitle(mode, capabilityCount)}
      aria-label={modeLabel(mode)}
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}

export function RunModeControl({
  mode,
  capabilityCount,
  disabled = false,
  pending = false,
  onChange,
}: {
  mode: RunMode;
  capabilityCount: number;
  disabled?: boolean;
  pending?: boolean;
  onChange: (mode: RunMode) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="inline-flex rounded-md border border-border bg-background p-0.5"
        role="group"
        aria-label="Run Mode"
      >
        <RunModeButton
          mode="auto"
          active={mode === "auto"}
          disabled={disabled || pending || capabilityCount === 0}
          pending={pending && mode === "auto"}
          onClick={() => onChange("auto")}
        />
        <RunModeButton
          mode="manual"
          active={mode === "manual"}
          disabled={disabled || pending || capabilityCount === 0}
          pending={pending && mode === "manual"}
          onClick={() => onChange("manual")}
        />
      </div>
    </div>
  );
}

function RunModeButton({
  mode,
  active,
  disabled,
  pending,
  onClick,
}: {
  mode: RunMode;
  active: boolean;
  disabled: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  const Icon = mode === "auto" ? Zap : CheckCircle2;
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className="h-7 w-7 rounded px-0"
      disabled={disabled}
      onClick={onClick}
      title={runModeTitle(mode)}
      aria-label={modeLabel(mode)}
      aria-pressed={active}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

function modeLabel(mode: RunMode): string {
  return mode === "auto" ? "Auto" : "Manual";
}

function runModeTitle(mode: RunMode, capabilityCount?: number): string {
  const suffix =
    typeof capabilityCount === "number"
      ? ` for ${capabilityCount} capability${capabilityCount === 1 ? "" : "ies"}`
      : "";
  return mode === "auto"
    ? `Run without approval${suffix}`
    : `Ask for approval${suffix}`;
}
