/**
 * @fileType component
 * @domain kody
 * @pattern vibe-toggle
 * @ai-summary Single-button toggle for the Vibe view. Visually reflects
 *   the current state — pressed/glowing when on `/vibe`, idle on `/`.
 *   Clicking always navigates to the *other* state, making it a true
 *   on/off switch instead of a one-way "go to Vibe" link.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

import { cn } from "@dashboard/lib/utils/ui";
import { SimpleTooltip } from "./SimpleTooltip";

export function VibeToggle({ className }: { className?: string }) {
  const pathname = usePathname() ?? "/";
  const on = pathname.startsWith("/vibe");
  const target = on ? "/" : "/vibe";
  const label = on ? "Turn off Vibe" : "Turn on Vibe";

  return (
    <SimpleTooltip content={label} side="bottom">
      <Link
        href={target}
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors",
          "border",
          on
            ? "bg-fuchsia-500/15 border-fuchsia-400/40 text-fuchsia-200 shadow-[0_0_0_1px_rgba(244,114,182,0.15)_inset]"
            : "border-white/[0.12] text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
          className,
        )}
      >
        <Sparkles
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            on ? "text-fuchsia-300" : "text-muted-foreground",
          )}
        />
      </Link>
    </SimpleTooltip>
  );
}
