/**
 * @fileType component
 * @domain kody
 * @pattern mobile-nav-sheet
 * @ai-summary Shared mobile navigation sheet used by both the Dashboard and
 *   Vibe pages. Owns the bits that are identical between them — user card,
 *   Vibe toggle, Workspace section, and the collapsible Settings list —
 *   and exposes slots for page-specific content (filters/actions on the
 *   dashboard, the issue picker on Vibe).
 *
 *   Why a shared component: prior to this, KodyDashboard and VibePage each
 *   hand-rolled ~150 lines of near-identical menu JSX. Any tweak had to be
 *   made twice (and would inevitably drift).
 */
"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  FileText,
  Github,
  Layers,
  LogOut,
  MessageSquare,
  ScrollText,
  Sparkles,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@dashboard/ui/sheet";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { cn } from "../utils";
import { SimpleTooltip } from "./SimpleTooltip";
import { SETTINGS_NAV_SECTIONS } from "./settings-nav";
import { InboxBadge } from "./InboxBadge";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

interface MobileMenuProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Primary action shown above the Jobs/Reports tiles (e.g. "Chat with Kody",
   *  or "Open issues" on the Vibe page). */
  workspacePrimary?: ReactNode;
  /** Extra sections rendered between Settings and the bottom CTA — Dashboard
   *  uses this for Filters + Actions. */
  extras?: ReactNode;
  /** Sticky CTA pinned at the bottom (e.g. "New Task" on the Dashboard). */
  bottomCta?: ReactNode;
}

export function MobileMenu({
  open,
  onOpenChange,
  workspacePrimary,
  extras,
  bottomCta,
}: MobileMenuProps) {
  const pathname = usePathname() ?? "/";
  const { githubUser, connectedRepo, clearGitHubUser } = useGitHubIdentity();

  const onVibe = pathname.startsWith("/vibe");
  const vibeHref = onVibe ? "/" : "/vibe";
  const vibeLabel = onVibe ? "Turn off Vibe" : "Turn on Vibe";
  const vibeHint = onVibe ? "Back to list" : "Preview · Chat · Ship";

  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[88vw] sm:w-[360px] !p-0 !gap-0 overflow-y-auto bg-black/95 border-white/[0.08]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>
            Navigation, identity, and quick actions.
          </SheetDescription>
        </SheetHeader>

        {(githubUser || connectedRepo) && (
          <div className="px-4 pt-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              {githubUser ? (
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage
                    src={githubUser.avatar_url}
                    alt={githubUser.login}
                  />
                  <AvatarFallback>
                    {githubUser.login[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Github className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {githubUser ? `@${githubUser.login}` : "Connected"}
                </div>
                {connectedRepo && (
                  <div className="text-[11px] text-muted-foreground truncate">
                    {connectedRepo}
                  </div>
                )}
              </div>
              {githubUser && (
                <SimpleTooltip content="Sign out">
                  <button
                    type="button"
                    onClick={() => {
                      clearGitHubUser();
                      close();
                    }}
                    className="shrink-0 h-8 w-8 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                    aria-label="Sign out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </SimpleTooltip>
              )}
            </div>
          </div>
        )}

        {/* Vibe toggle — state-aware. */}
        <div className="px-4 pt-3">
          <Link
            href={vibeHref}
            role="switch"
            aria-checked={onVibe}
            onClick={close}
            className={cn(
              "flex items-center gap-3 h-12 px-4 rounded-xl border transition-colors",
              onVibe
                ? "border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/20"
                : "border-fuchsia-400/30 bg-gradient-to-r from-fuchsia-500/10 to-pink-500/5 text-fuchsia-100 hover:from-fuchsia-500/15 hover:to-pink-500/10",
            )}
          >
            <span
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md",
                onVibe ? "bg-fuchsia-500/30" : "bg-fuchsia-500/20",
              )}
            >
              <Sparkles
                className={cn(
                  "w-4 h-4",
                  onVibe ? "text-fuchsia-200" : "text-fuchsia-300",
                )}
              />
            </span>
            <span className="text-sm font-medium flex-1">{vibeLabel}</span>
            <span
              className={cn(
                "text-[11px]",
                onVibe ? "text-fuchsia-200/70" : "text-fuchsia-300/70",
              )}
            >
              {vibeHint}
            </span>
          </Link>
        </div>

        {/* Workspace — page-specific primary action + Jobs/Workers/Reports tiles. */}
        <div className="px-4 pt-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-2 px-1">
            Workspace
          </div>
          {workspacePrimary}
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Link
              href="/jobs"
              onClick={close}
              className="flex flex-col items-start gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/10">
                <Layers className="w-4 h-4 text-amber-300" />
              </span>
              <span className="text-sm font-medium">Jobs</span>
              <span className="text-[11px] text-muted-foreground">
                Run and edit
              </span>
            </Link>
            <Link
              href="/workers"
              onClick={close}
              className="flex flex-col items-start gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-violet-500/10">
                <Bot className="w-4 h-4 text-violet-300" />
              </span>
              <span className="text-sm font-medium">Workers</span>
              <span className="text-[11px] text-muted-foreground">
                Run and edit
              </span>
            </Link>
            <Link
              href="/messages"
              onClick={close}
              className="flex flex-col items-start gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10">
                <MessageSquare className="w-4 h-4 text-emerald-300" />
              </span>
              <span className="text-sm font-medium">Messages</span>
              <span className="text-[11px] text-muted-foreground">
                Team chat
              </span>
            </Link>
            <Link
              href="/jobs?tab=reports"
              onClick={close}
              className="flex flex-col items-start gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-sky-500/10">
                <FileText className="w-4 h-4 text-sky-300" />
              </span>
              <span className="text-sm font-medium">Reports</span>
              <span className="text-[11px] text-muted-foreground">
                Job outputs
              </span>
            </Link>
            <Link
              href="/changelog"
              onClick={close}
              className="flex flex-col items-start gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10">
                <ScrollText className="w-4 h-4 text-emerald-300" />
              </span>
              <span className="text-sm font-medium">Changelog</span>
              <span className="text-[11px] text-muted-foreground">
                What shipped
              </span>
            </Link>
          </div>
        </div>

        {/* Settings — always expanded. */}
        <div className="px-4 pt-4">
          <div className="px-1 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground/70">
            Settings
          </div>
          <div className="space-y-3 mt-1">
            {SETTINGS_NAV_SECTIONS.map((section) => (
                <div key={section.title}>
                  <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                    {section.title}
                  </p>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden divide-y divide-white/[0.04]">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={close}
                          className="flex items-center gap-3 h-12 px-3 hover:bg-white/[0.04] transition-colors"
                        >
                          <span
                            className={cn(
                              "inline-flex h-7 w-7 items-center justify-center rounded-md",
                              item.tint,
                            )}
                          >
                            <Icon className="w-4 h-4" />
                          </span>
                          <span className="text-sm font-medium flex-1 flex items-center gap-2">
                            {item.label}
                            {item.href === "/inbox" && <InboxBadge />}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
            ))}
          </div>
        </div>

        {extras}

        {APP_VERSION && (
          <p className="px-5 pt-3 pb-1 text-[10px] font-mono text-muted-foreground/50 select-none">
            v{APP_VERSION}
          </p>
        )}

        {bottomCta && (
          <div className="sticky bottom-0 px-4 py-3 border-t border-white/[0.08] bg-black/95 backdrop-blur">
            {bottomCta}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
