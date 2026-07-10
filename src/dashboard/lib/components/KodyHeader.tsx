/**
 * @fileType component
 * @domain kody
 * @pattern dashboard-header
 * @ai-summary Top action bar shared by the Dashboard and Vibe pages.
 *   Mirrors the dashboard layout so navigating between the two surfaces
 *   feels like a view switch, not a route change. Navigation between views
 *   (Dashboard / Tasks / Vibe) lives in the rail's "Views" group, not here.
 *
 *   Page-specific state (notifications, branch cleanup dialog, refetch,
 *   publish callback) is passed in as props so each host owns its own
 *   query/mutation lifecycle. Hooks that are safe to call per-instance
 *   (theme, GitHub identity) are read directly inside the header.
 */
"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, MessageSquare, RefreshCw } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { useNotifications } from "../notifications/NotificationsProvider";
import { cn } from "../utils";
import { useAuth } from "../auth-context";
import { useChatScope } from "./ChatRailShell";
import { RepoSwitcher } from "@kody-ade/kody-chat/components/RepoSwitcher";
import { SimpleTooltip } from "./SimpleTooltip";

interface KodyHeaderProps {
  /** Opens the page-specific mobile menu (host renders the Sheet). */
  onOpenMobileMenu: () => void;

  /** Refetch hook for the Refresh button; host decides what gets re-fetched. */
  onRefresh: () => void;
  isFetching: boolean;

  /** Optional slot rendered inline with desktop controls (e.g. PR badge in Vibe). */
  desktopExtras?: ReactNode;
  /**
   * Optional slot pinned to the trailing edge — after notifications/refresh.
   * The dashboard puts its `⋯` overflow menu here so the kebab reads as the
   * last item, per toolbar convention.
   */
  trailingExtras?: ReactNode;
  /** Optional slot rendered before the mobile hamburger (e.g. Issues button in Vibe). */
  mobileExtras?: ReactNode;
  /**
   * Optional desktop-only filter cluster rendered next to the title (the
   * dashboard folds its FilterBar in here so search/filters share the top
   * bar instead of a separate sub-row). Vibe leaves it unset.
   */
  filterBar?: ReactNode;
  /**
   * Show the built-in desktop Refresh button. Defaults to true; the dashboard
   * sets it false because Refresh lives inside its header overflow menu.
   */
  showRefresh?: boolean;
}

export function KodyHeader({
  onOpenMobileMenu,
  onRefresh,
  isFetching,
  desktopExtras,
  trailingExtras,
  mobileExtras,
  filterBar,
  showRefresh = true,
}: KodyHeaderProps) {
  const pathname = usePathname();
  const { auth } = useAuth();
  const { openMobileChat } = useChatScope();
  const {
    store: notificationStore,
    permission: notificationPermission,
    isSupported: notificationsSupported,
    requestPermission,
  } = useNotifications();

  return (
    <div className="flex min-h-16 items-center justify-between border-b border-white/[0.06] bg-black/20 px-5 py-4 md:px-7">
      <div className="flex min-w-0 items-center gap-3.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <RepoSwitcher />
        </div>
      </div>

      {/* Desktop controls — data tools (search/filter) sit here, separated from
          the title/Vibe identity group, then a divider before app actions. */}
      <div className="hidden items-center gap-3.5 md:flex">
        {filterBar ? (
          <>
            {filterBar}
            <div className="mx-1 h-6 w-px bg-white/[0.1]" aria-hidden="true" />
          </>
        ) : null}

        {desktopExtras}

        <NotificationCenter
          store={notificationStore}
          browserPermission={notificationPermission}
          isSupported={notificationsSupported}
          onRequestPermission={requestPermission}
        />

        {showRefresh && (
          <SimpleTooltip content="Refresh" side="bottom">
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isFetching}
              aria-label="Refresh"
              className="gap-1"
            >
              <RefreshCw
                className={cn("h-5 w-5", isFetching && "animate-spin")}
              />
            </Button>
          </SimpleTooltip>
        )}

        {trailingExtras}
      </div>

      {/* Mobile cluster — chat opener (the rail is desktop-only) +
          page-specific extras (e.g. issue picker) + hamburger. */}
      <div className="flex items-center gap-1.5 md:hidden">
        {auth && pathname !== "/chat" && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Open chat"
            title="Chat"
            onClick={openMobileChat}
          >
            <MessageSquare className="h-5 w-5" />
          </Button>
        )}
        {mobileExtras}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open menu"
          onClick={onOpenMobileMenu}
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
