/**
 * @fileType component
 * @domain kody
 * @pattern app-sidebar
 * @ai-summary Persistent left navigation rail for the Kody dashboard.
 *   Desktop only (hidden below md). Collapsible (64px ↔ 220px) with
 *   localStorage persistence. Top-level entries come from the shared
 *   workspace and settings nav lists, so desktop, mobile, and command palette
 *   destinations stay discoverable. The desktop rail can regroup a few
 *   repo-workspace pages without moving the underlying routes.
 */
"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Github,
  LogOut,
  Moon,
  Search,
  Sparkles,
  Sun,
  Wrench,
  X,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import { useTheme } from "@dashboard/providers/Theme";
import { cn } from "@dashboard/lib/utils/ui";
import {
  shouldEnableSidebarInboxBadgeData,
  shouldEnableSidebarMessagesBadgeData,
  shouldEnableSidebarReportsBadgeData,
} from "../github-background-polling";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { SimpleTooltip } from "./SimpleTooltip";
import { InboxBadge } from "./InboxBadge";
import { MessagesBadge } from "./MessagesBadge";
import { ReportsBadge } from "./ReportsBadge";
import {
  DASHBOARD_NAV_ITEM,
  PRIMARY_NAV_ITEMS,
  PRIMARY_NAV_TITLE,
  PREVIEW_NAV_ITEM,
  PRIMARY_VIEW_TITLE,
  SETTINGS_NAV_SECTIONS,
  TASKS_NAV_ITEM,
  VIBE_NAV_ITEM,
  type SettingsNavItem,
} from "./settings-nav";

/** Pull just the `text-…` color token out of an item's `tint` (which is a
 *  combined "text-X bg-Y" chip class) so the rail can color the bare icon. */
function iconTintClass(item: SettingsNavItem): string | undefined {
  return item.tint?.split(" ").find((c) => c.startsWith("text-"));
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

type NavItem = SettingsNavItem;
type SidebarMode = "vibe" | "engineer";

const COLLAPSED_KEY = "kody.sidebar.collapsed";
const MODE_KEY = "kody.sidebar.mode";
const NAV_ITEM_BY_HREF = new Map(
  [
    DASHBOARD_NAV_ITEM,
    TASKS_NAV_ITEM,
    VIBE_NAV_ITEM,
    PREVIEW_NAV_ITEM,
    ...PRIMARY_NAV_ITEMS,
    ...SETTINGS_NAV_SECTIONS.flatMap((section) => section.items),
  ].map((item) => [item.href, item] as const),
);

function sidebarItem(href: string): NavItem {
  const item = NAV_ITEM_BY_HREF.get(href);
  if (!item) throw new Error(`Missing sidebar item for ${href}`);
  return item;
}

function settingsSection(title: string): {
  title: string;
  items: readonly NavItem[];
} {
  const section = SETTINGS_NAV_SECTIONS.find((item) => item.title === title);
  if (!section) throw new Error(`Missing sidebar section ${title}`);
  return section;
}

const VIBE_MODE_SECTIONS: Array<{ title: string; items: readonly NavItem[] }> =
  [
    {
      title: PRIMARY_VIEW_TITLE,
      items: [VIBE_NAV_ITEM, PREVIEW_NAV_ITEM],
    },
    {
      title: PRIMARY_NAV_TITLE,
      items: [
        sidebarItem("/org"),
        sidebarItem("/todos"),
        sidebarItem("/messages"),
        sidebarItem("/reports"),
        sidebarItem("/cms"),
        sidebarItem("/docs"),
        sidebarItem("/changelog"),
      ],
    },
  ];
const ENGINEER_MODE_SECTIONS: Array<{
  title: string;
  items: readonly NavItem[];
}> = [
  {
    title: PRIMARY_VIEW_TITLE,
    items: [TASKS_NAV_ITEM, VIBE_NAV_ITEM, PREVIEW_NAV_ITEM],
  },
  settingsSection("Operations"),
  {
    title: PRIMARY_NAV_TITLE,
    items: [
      sidebarItem("/org"),
      sidebarItem("/todos"),
      sidebarItem("/messages"),
      sidebarItem("/reports"),
      sidebarItem("/cms"),
      sidebarItem("/files"),
      sidebarItem("/docs"),
      sidebarItem("/changelog"),
    ],
  },
  settingsSection("Monitoring"),
  settingsSection("Fly"),
  settingsSection("Agent"),
  settingsSection("Engine"),
  settingsSection("Company"),
  settingsSection("Infrastructure"),
  settingsSection("Alerts"),
  { title: "General", items: [sidebarItem("/settings")] },
];

function isActive(pathname: string, search: string, item: NavItem): boolean {
  // Hrefs may include a query string (e.g. "/reports"). Compare the
  // pathname and search portions independently so tab-scoped entries don't
  // collide with their bare-path siblings.
  const [hrefPath, hrefQuery = ""] = item.href.split("?");
  if (hrefQuery) {
    return pathname === hrefPath && search === hrefQuery;
  }
  if (item.exact) return pathname === hrefPath && !search;
  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}

function isSidebarMode(value: string | null): value is SidebarMode {
  return value === "vibe" || value === "engineer";
}

function defaultModeForPathname(pathname: string): SidebarMode {
  if (pathname === "/vibe" || pathname.startsWith("/vibe/")) return "vibe";
  return "engineer";
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const enableInboxBadgeData = shouldEnableSidebarInboxBadgeData(pathname);
  const enableMessagesBadgeData =
    shouldEnableSidebarMessagesBadgeData(pathname);
  const enableReportsBadgeData = shouldEnableSidebarReportsBadgeData(pathname);
  const { githubUser, connectedRepo, clearGitHubUser } = useGitHubIdentity();
  const { theme, setTheme } = useTheme();
  const [userMenuOpen, setUserMenuOpen] = useState<boolean>(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    defaultModeForPathname(pathname),
  );

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSED_KEY) === "1") {
        setCollapsed(true);
      }
      const storedMode = window.localStorage.getItem(MODE_KEY);
      if (isSidebarMode(storedMode)) {
        setSidebarMode(storedMode);
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to defaults
    }
    setHydrated(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore — UI still updates
      }
      return next;
    });
  };

  const selectSidebarMode = (next: SidebarMode) => {
    if (next === sidebarMode) return;
    setSidebarMode(next);
    setQuery("");
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // ignore — UI still updates
    }
    router.push(next === "vibe" ? "/vibe" : "/tasks");
  };

  useEffect(() => {
    setQuery("");
  }, [sidebarMode]);

  // Inline filter — narrows the rail's own sections by label/description as
  // the user types. Empty sections drop out so a query collapses the list to
  // just its matches.
  const filteredSections = useMemo(() => {
    const base =
      sidebarMode === "vibe" ? VIBE_MODE_SECTIONS : ENGINEER_MODE_SECTIONS;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          `${item.label} ${item.description ?? ""}`.toLowerCase().includes(q),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [query, sidebarMode]);

  const firstMatch = filteredSections[0]?.items[0];

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setQuery("");
    } else if (e.key === "Enter" && firstMatch) {
      e.preventDefault();
      router.push(firstMatch.href);
      setQuery("");
    }
  };

  const width = collapsed ? "w-[64px]" : "w-[220px]";

  const renderLink = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(pathname, search, item);
    const link = (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        aria-label={item.label}
        className={cn(
          "relative flex items-center gap-3 rounded-md text-sm transition-colors",
          "h-9 px-3",
          collapsed && "justify-center px-0",
          active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
      >
        <Icon className={cn("w-4 h-4 shrink-0", iconTintClass(item))} />
        {!collapsed && <span className="truncate">{item.label}</span>}
        {item.href === "/inbox" && (
          <InboxBadge
            enabled={enableInboxBadgeData}
            className={cn(collapsed ? "absolute top-1 right-1" : "ml-auto")}
          />
        )}
        {item.href === "/messages" && (
          <MessagesBadge
            enabled={enableMessagesBadgeData}
            className={cn(collapsed ? "absolute top-1 right-1" : "ml-auto")}
          />
        )}
        {item.href === "/reports" && (
          <ReportsBadge
            enabled={enableReportsBadgeData}
            className={cn(collapsed ? "absolute top-1 right-1" : "ml-auto")}
          />
        )}
      </Link>
    );
    return collapsed ? (
      <SimpleTooltip key={item.href} content={item.label} side="right">
        {link}
      </SimpleTooltip>
    ) : (
      <div key={item.href}>{link}</div>
    );
  };

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col shrink-0 border-r border-white/[0.06] bg-black/30",
        "h-full z-30 transition-[width] duration-150 ease-out",
        width,
      )}
      aria-label="Primary navigation"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <div
        className={cn(
          "flex items-center px-3 h-14 border-b border-white/[0.06]",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        <SimpleTooltip
          content={APP_VERSION ? `Kody v${APP_VERSION}` : "Kody"}
          side="right"
        >
          <Link
            href="/"
            className="flex items-center gap-2 text-foreground hover:text-foreground/80"
            aria-label={
              APP_VERSION ? `Kody home (v${APP_VERSION})` : "Kody home"
            }
          >
            <div className="h-7 w-7 rounded-md bg-emerald-600 flex items-center justify-center text-white font-semibold text-sm shrink-0">
              K
            </div>
            {!collapsed && (
              <span className="text-sm font-semibold tracking-tight truncate">
                Kody
              </span>
            )}
          </Link>
        </SimpleTooltip>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        <div className="pb-2">{renderLink(DASHBOARD_NAV_ITEM)}</div>

        <div className="pb-2">
          {collapsed ? (
            <SimpleTooltip
              content={
                sidebarMode === "vibe" ? "Switch to Engineer" : "Switch to Vibe"
              }
              side="right"
            >
              <button
                type="button"
                onClick={() =>
                  selectSidebarMode(
                    sidebarMode === "vibe" ? "engineer" : "vibe",
                  )
                }
                aria-label={
                  sidebarMode === "vibe"
                    ? "Switch to Engineer"
                    : "Switch to Vibe"
                }
                className="flex items-center justify-center w-full rounded-md h-9 text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
              >
                {sidebarMode === "vibe" ? (
                  <Wrench className="w-4 h-4 shrink-0" />
                ) : (
                  <Sparkles className="w-4 h-4 shrink-0" />
                )}
              </button>
            </SimpleTooltip>
          ) : (
            <div
              className="grid grid-cols-2 gap-1 rounded-md border border-white/[0.08] bg-black/20 p-1"
              aria-label="Sidebar mode"
            >
              <button
                type="button"
                onClick={() => selectSidebarMode("vibe")}
                aria-pressed={sidebarMode === "vibe"}
                className={cn(
                  "flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors",
                  sidebarMode === "vibe"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>Vibe</span>
              </button>
              <button
                type="button"
                onClick={() => selectSidebarMode("engineer")}
                aria-pressed={sidebarMode === "engineer"}
                className={cn(
                  "flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors",
                  sidebarMode === "engineer"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Wrench className="w-3.5 h-3.5 shrink-0" />
                <span>Engineer</span>
              </button>
            </div>
          )}
        </div>

        {/* Inline search — filters the rail's own items as you type. Collapsed
            mode shows an icon that expands the rail so there's room to type. */}
        {sidebarMode === "engineer" && (
          <div className="pb-1">
            {collapsed ? (
              <SimpleTooltip content="Search" side="right">
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  aria-label="Search"
                  className="flex items-center justify-center w-full rounded-md h-9 text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                >
                  <Search className="w-4 h-4 shrink-0" />
                </button>
              </SimpleTooltip>
            ) : (
              <div className="flex items-center gap-2 w-full rounded-md h-9 px-3 text-sm border border-white/[0.08] bg-black/20 transition-colors focus-within:border-white/[0.18]">
                <Search className="w-4 h-4 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search…"
                  aria-label="Search navigation"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5 shrink-0" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Nav sections — ordered by the main work loop, sourced from the
            shared settings-nav so new pages appear here automatically. Filtered
            live by the inline search; section headings show only when expanded,
            collapsed mode is a flat icon list. */}
        {filteredSections.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No matches.
          </p>
        ) : (
          filteredSections.map((section, i) => (
            <div key={section.title} className="space-y-1">
              {!collapsed && (
                <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  {section.title}
                </p>
              )}
              {collapsed && i > 0 && (
                <div
                  className="my-2 mx-3 border-t border-white/[0.06]"
                  aria-hidden="true"
                />
              )}
              {section.items.map((item) => renderLink(item))}
            </div>
          ))
        )}
      </nav>

      <div className="border-t border-white/[0.06] p-2 space-y-1">
        {/* GitHub identity — click to reveal connected repo + sign out.
            Persistent app chrome, moved here from the page header. */}
        {(githubUser || connectedRepo) && (
          <div className="relative">
            <SimpleTooltip
              content={
                githubUser
                  ? `@${githubUser.login}${connectedRepo ? ` · ${connectedRepo}` : ""}`
                  : (connectedRepo ?? "Connected")
              }
              side="right"
            >
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label="Account"
                className={cn(
                  "flex items-center gap-3 w-full rounded-md text-sm h-9 px-3 transition-colors",
                  "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  collapsed && "justify-center px-0",
                )}
              >
                {githubUser ? (
                  <Avatar className="h-5 w-5 shrink-0">
                    <AvatarImage
                      src={githubUser.avatar_url}
                      alt={githubUser.login}
                    />
                    <AvatarFallback>
                      {githubUser.login[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Github className="w-4 h-4 shrink-0" />
                )}
                {!collapsed && (
                  <span className="truncate flex-1 text-left">
                    {githubUser ? `@${githubUser.login}` : "Connected"}
                  </span>
                )}
              </button>
            </SimpleTooltip>
            {userMenuOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-56 py-1 bg-popover border rounded-md shadow-lg z-50">
                {connectedRepo && (
                  <div className="px-3 py-1.5 text-xs text-muted-foreground border-b mb-1">
                    <span className="font-medium text-foreground">Repo:</span>{" "}
                    {connectedRepo}
                  </div>
                )}
                {githubUser ? (
                  <button
                    type="button"
                    onClick={() => {
                      clearGitHubUser();
                      setUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <LogOut className="w-3.5 h-3.5 shrink-0" />
                    Sign out
                  </button>
                ) : (
                  <div className="px-3 py-1.5 text-xs text-muted-foreground">
                    No GitHub user signed in.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Theme toggle — global chrome, moved here from the page header. */}
        <SimpleTooltip
          content={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          side="right"
        >
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            className={cn(
              "flex items-center gap-3 w-full rounded-md text-sm h-9 px-3",
              "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4 shrink-0" />
            ) : (
              <Moon className="w-4 h-4 shrink-0" />
            )}
            {!collapsed && (
              <span className="truncate">
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </span>
            )}
          </button>
        </SimpleTooltip>

        <SimpleTooltip
          content={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          side="right"
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex items-center gap-3 w-full rounded-md text-sm h-9 px-3",
              "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4 shrink-0" />
            ) : (
              <ChevronLeft className="w-4 h-4 shrink-0" />
            )}
            {!collapsed && <span className="truncate">Collapse</span>}
          </button>
        </SimpleTooltip>

        {APP_VERSION && (
          <p
            className={cn(
              "pt-1 text-[10px] font-mono text-muted-foreground/50 select-none",
              collapsed ? "text-center" : "px-3",
            )}
          >
            v{APP_VERSION}
          </p>
        )}
      </div>
    </aside>
  );
}
