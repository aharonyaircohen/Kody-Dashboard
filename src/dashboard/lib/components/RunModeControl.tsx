"use client";

import { Loader2, ShieldCheck, ShieldOff, Zap, ZapOff } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import type { RunMode } from "../cto/run-mode";
import { cn } from "../utils";

const activeIconButtonClassName =
  "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200";

export function RunModeBadge({
  mode,
  capabilityCount,
}: {
  mode: RunMode;
  capabilityCount?: number;
}) {
  const approvalRequired = mode !== "auto";
  const Icon = approvalRequired ? ShieldCheck : ShieldOff;
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border",
        approvalRequired
          ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
          : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
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
  const approvalRequired = mode !== "auto";
  const Icon = approvalRequired ? ShieldCheck : ShieldOff;
  return (
    <Button
      type="button"
      variant={approvalRequired ? "secondary" : "outline"}
      size="sm"
      className={cn(
        "h-8 w-8 rounded-md px-0",
        approvalRequired && activeIconButtonClassName,
      )}
      disabled={disabled || pending || capabilityCount === 0}
      onClick={() => onChange(approvalRequired ? "auto" : "manual")}
      title={runModeTitle(mode, capabilityCount)}
      aria-label={runModeTitle(mode, capabilityCount)}
      aria-pressed={approvalRequired}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

export function KodyTriggerControl({
  enabled,
  disabled = false,
  pending = false,
  onChange,
}: {
  enabled: boolean;
  disabled?: boolean;
  pending?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const Icon = enabled ? Zap : ZapOff;
  return (
    <Button
      type="button"
      variant={enabled ? "secondary" : "outline"}
      size="sm"
      className={cn(
        "h-8 w-8 rounded-md px-0",
        enabled && activeIconButtonClassName,
      )}
      disabled={disabled || pending}
      onClick={() => onChange(!enabled)}
      title={kodyTriggerTitle(enabled)}
      aria-label={kodyTriggerTitle(enabled)}
      aria-pressed={enabled}
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
  return mode === "auto"
    ? "Human approval not required"
    : "Human approval required";
}

function runModeTitle(mode: RunMode, capabilityCount?: number): string {
  const suffix =
    typeof capabilityCount === "number"
      ? ` for ${capabilityCount} ${
          capabilityCount === 1 ? "capability" : "capabilities"
        }`
      : "";
  return mode === "auto"
    ? `Human approval not required${suffix}`
    : `Human approval required${suffix}`;
}

function kodyTriggerTitle(enabled: boolean): string {
  return enabled ? "Kody can trigger" : "Kody cannot trigger";
}
