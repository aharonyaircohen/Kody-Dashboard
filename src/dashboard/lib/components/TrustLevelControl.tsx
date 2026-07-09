"use client";

import { Loader2, ShieldAlert, ShieldCheck, Zap } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import type { TrustLevel } from "../cto/trust-state";
import { cn } from "../utils";

const trustLevelOptions: Array<{
  value: TrustLevel;
  label: string;
  Icon: typeof ShieldAlert;
  className: string;
}> = [
  {
    value: "approval-required",
    label: "Require approval",
    Icon: ShieldAlert,
    className:
      "border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25 hover:text-red-200",
  },
  {
    value: "can-run",
    label: "Kody can run",
    Icon: Zap,
    className:
      "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 hover:text-amber-200",
  },
  {
    value: "auto-approval",
    label: "Auto approval",
    Icon: ShieldCheck,
    className:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200",
  },
];

export function TrustLevelControl({
  value,
  pending = false,
  onChange,
}: {
  value: TrustLevel;
  pending?: boolean;
  onChange: (value: TrustLevel) => void;
}) {
  const currentIndex = trustLevelOptions.findIndex(
    (option) => option.value === value,
  );
  const current = trustLevelOptions[currentIndex] ?? trustLevelOptions[0]!;
  const next =
    trustLevelOptions[
      (Math.max(currentIndex, 0) + 1) % trustLevelOptions.length
    ] ?? trustLevelOptions[0]!;
  const { Icon } = current;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "h-9 w-9 rounded-md px-0",
        current.className,
        pending && "cursor-not-allowed opacity-60",
      )}
      data-trust-level={current.value}
      aria-disabled={pending}
      aria-label={`Trust level: ${current.label}`}
      title={`${current.label} - click for ${next.label}`}
      onClick={() => {
        if (pending) return;
        onChange(next.value);
      }}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
      <span className="sr-only">{current.label}</span>
    </Button>
  );
}
