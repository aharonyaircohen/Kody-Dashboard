/**
 * @fileType component
 * @domain kody
 * @pattern vibe-toggle
 * @ai-summary Segmented Dashboard ⟷ Vibe view switch. Vibe is an alternative
 *   visualization of the same dashboard (not a separate page), so it reads as
 *   a two-option mode toggle rather than a lone icon that blends in with the
 *   search/filter controls. Active state is exact: the Dashboard segment lights
 *   only on `/`, the Vibe segment only on `/vibe`; on other pages (Jobs,
 *   Workers) neither is selected and the control acts as quick navigation.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Sparkles } from "lucide-react";

import { cn } from "@dashboard/lib/utils/ui";

const SEGMENT_BASE =
  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors";

export function VibeToggle({ className }: { className?: string }) {
  const pathname = usePathname() ?? "/";
  const onVibe = pathname.startsWith("/vibe");
  const onDashboard = pathname === "/";

  return (
    <div
      role="tablist"
      aria-label="Dashboard view"
      className={cn(
        "inline-flex items-center rounded-md bg-white/[0.04] border border-white/[0.06] p-0.5 gap-0.5",
        className,
      )}
    >
      <Link
        href="/"
        role="tab"
        aria-selected={onDashboard}
        className={cn(
          SEGMENT_BASE,
          onDashboard
            ? "bg-zinc-600 text-white shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]",
        )}
      >
        <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
        Dashboard
      </Link>
      <Link
        href="/vibe"
        role="tab"
        aria-selected={onVibe}
        className={cn(
          SEGMENT_BASE,
          onVibe
            ? "bg-fuchsia-600 text-white shadow-sm"
            : "text-muted-foreground hover:text-fuchsia-200 hover:bg-fuchsia-500/10",
        )}
      >
        <Sparkles className="w-3.5 h-3.5 shrink-0" />
        Vibe
      </Link>
    </div>
  );
}
