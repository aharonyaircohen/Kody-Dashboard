/**
 * @fileType component
 * @domain kody
 * @pattern view-toggle
 * @ai-summary Two-segment Chat | Tasks switch, icon-only. Each segment is a
 *   Link, so switching is route-driven (back button + deep links work). The
 *   active segment is derived from the pathname. Clicking remembers the choice
 *   in localStorage so `/` lands the user back on their last view (see
 *   PrimaryViewRedirect). Lives next to the Vibe button in each view's header.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, MessageSquare, type LucideIcon } from "lucide-react";

import { cn } from "@dashboard/lib/utils/ui";
import { SimpleTooltip } from "./SimpleTooltip";

export const PRIMARY_VIEW_KEY = "kody:primary-view";
export type PrimaryView = "chat" | "tasks";

/** Persist the user's last primary view so `/` reopens it. */
export function rememberPrimaryView(view: PrimaryView): void {
  try {
    window.localStorage.setItem(PRIMARY_VIEW_KEY, view);
  } catch {
    // localStorage unavailable (private mode) — non-fatal, default applies.
  }
}

/** Read the saved primary view, defaulting to chat (the assistant-first view). */
export function readPrimaryView(): PrimaryView {
  try {
    const v = window.localStorage.getItem(PRIMARY_VIEW_KEY);
    if (v === "chat" || v === "tasks") return v;
  } catch {
    // ignore — fall through to default
  }
  return "chat";
}

const ITEMS: ReadonlyArray<{
  view: PrimaryView;
  href: string;
  label: string;
  icon: LucideIcon;
}> = [
  { view: "chat", href: "/chat", label: "Chat", icon: MessageSquare },
  { view: "tasks", href: "/tasks", label: "Tasks", icon: LayoutGrid },
];

export function ViewToggle({ className }: { className?: string }) {
  const pathname = usePathname() ?? "/chat";

  return (
    <div
      role="tablist"
      aria-label="Primary view"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-white/[0.12] bg-black/20 p-0.5",
        className,
      )}
    >
      {ITEMS.map((it) => {
        const Icon = it.icon;
        const active =
          pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <SimpleTooltip key={it.view} content={it.label} side="bottom">
            <Link
              href={it.href}
              role="tab"
              aria-selected={active}
              aria-label={it.label}
              onClick={() => rememberPrimaryView(it.view)}
              className={cn(
                "inline-flex items-center justify-center h-7 w-8 rounded transition-colors",
                active
                  ? "bg-emerald-500/15 text-emerald-200"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
            </Link>
          </SimpleTooltip>
        );
      })}
    </div>
  );
}
