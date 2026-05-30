/**
 * @fileType component
 * @domain kody
 * @pattern dashboard-header
 * @ai-summary Top action bar shared by the Dashboard and Vibe pages.
 *   Mirrors the dashboard layout so navigating between the two surfaces
 *   feels like a view toggle, not a route change. The only visual delta
 *   between the two pages is the VibeToggle, which reflects the current
 *   route via usePathname.
 *
 *   Page-specific state (notifications, branch cleanup dialog, refetch,
 *   publish callback) is passed in as props so each host owns its own
 *   query/mutation lifecycle. Hooks that are safe to call per-instance
 *   (theme, GitHub identity) are read directly inside the header.
 */
"use client";

import { type ReactNode } from "react";
import { Menu, RefreshCw } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { useNotifications } from "../notifications/NotificationsProvider";
import { cn } from "../utils";
import { SimpleTooltip } from "./SimpleTooltip";
import { VibeToggle } from "./VibeToggle";

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
  const { connectedRepo } = useGitHubIdentity();
  const {
    store: notificationStore,
    permission: notificationPermission,
    isSupported: notificationsSupported,
    requestPermission,
  } = useNotifications();

  return (
    <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-white/[0.06] bg-black/20">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-lg md:text-xl font-semibold text-foreground truncate">
            {connectedRepo?.split("/").pop() || "Kody Operations"}
          </h1>
        </div>
        <VibeToggle className="hidden sm:inline-flex" />
      </div>

      {/* Desktop controls — data tools (search/filter) sit here, separated from
          the title/Vibe identity group, then a divider before app actions. */}
      <div className="hidden md:flex items-center gap-3">
        {filterBar ? (
          <>
            {filterBar}
            <div className="h-5 w-px bg-white/[0.1] mx-1" aria-hidden="true" />
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
                className={cn("w-4 h-4", isFetching && "animate-spin")}
              />
            </Button>
          </SimpleTooltip>
        )}

        {trailingExtras}
      </div>

      {/* Mobile cluster — page-specific extras (e.g. issue picker) + hamburger. */}
      <div className="flex md:hidden items-center gap-1">
        {mobileExtras}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open menu"
          onClick={onOpenMobileMenu}
        >
          <Menu className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
