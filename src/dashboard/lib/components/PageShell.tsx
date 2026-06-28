/**
 * @fileType component
 * @domain layout
 * @pattern page-shell
 * @ai-summary Shared visual chrome for top-level dashboard pages. Exports
 *   two pieces:
 *
 *   - `<PageHeader />` — the sticky header bar (back arrow, icon, title,
 *     subtitle, right-side actions). Use this directly when a page owns
 *     its own body layout (e.g. Reports/Capabilities with internal scroll regions).
 *
 *   - `<PageShell />` — convenience wrapper that combines `PageHeader`
 *     with the dark page background and a scrolling content area. Use
 *     this for ordinary forms/lists (Secrets, Settings, Notifications,
 *     Repositories) so they all share one source of truth.
 *
 *   Both honour the same colour tokens, so a page using `<PageHeader />`
 *   on top of a custom body still matches one that uses the full shell.
 */
"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { cn } from "../utils";

interface PageHeaderProps {
  title: string;
  titleContent?: React.ReactNode;
  icon?: LucideIcon;
  iconClassName?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  backHref?: string | null;
  className?: string;
}

export function PageHeader({
  title,
  titleContent,
  icon: Icon,
  iconClassName,
  subtitle,
  actions,
  backHref = "/",
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "shrink-0 flex items-center justify-between gap-3 border-b border-white/[0.06] bg-black/30 px-5 py-4 md:px-7 md:py-5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        {backHref && (
          <Button asChild variant="ghost" size="sm">
            <Link href={backHref} aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        )}
        {Icon && (
          <Icon
            className={cn("h-6 w-6 shrink-0", iconClassName ?? "text-white/70")}
          />
        )}
        {titleContent ?? (
          <h1 className="truncate text-heading-md font-semibold md:text-heading-lg">
            {title}
          </h1>
        )}
        {subtitle && (
          <span className="truncate text-body-xs text-white/45">
            {subtitle}
          </span>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2.5">{actions}</div>
      )}
    </header>
  );
}

interface PageShellProps extends PageHeaderProps {
  /** Tighten the content max-width. Use "full" to opt out. */
  width?: "narrow" | "wide" | "full";
  /** Extra classes on the <main> wrapper. */
  contentClassName?: string;
  children: React.ReactNode;
}

const WIDTH_CLASS: Record<NonNullable<PageShellProps["width"]>, string> = {
  narrow: "max-w-3xl",
  wide: "max-w-6xl",
  full: "",
};

export function PageShell({
  width = "narrow",
  contentClassName,
  children,
  ...header
}: PageShellProps) {
  const widthCls = WIDTH_CLASS[width];
  return (
    <div className="h-full min-h-0 flex flex-col bg-black/95 text-white/90">
      <PageHeader {...header} />
      <main
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-5 py-7 md:px-7 md:py-8",
          widthCls && `${widthCls} w-full mx-auto`,
          contentClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}
