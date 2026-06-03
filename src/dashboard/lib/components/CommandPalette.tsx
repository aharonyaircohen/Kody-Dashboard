/**
 * @fileType component
 * @domain kody
 * @pattern command-palette
 * @ai-summary App-wide ⌘K / Ctrl+K command palette. One global instance
 *   mounted by ChatRailShell. Feeds from the shared nav lists
 *   (PRIMARY_NAV_ITEMS + SETTINGS_NAV_SECTIONS) so every destination is
 *   reachable from the keyboard on every page, plus a few global actions
 *   (toggle Vibe, toggle theme, sign out). No external dependency —
 *   built on the existing Radix dialog primitive, not cmdk.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  CornerDownLeft,
  LogOut,
  Moon,
  Search,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { useTheme } from "@dashboard/providers/Theme";
import { cn } from "@dashboard/lib/utils/ui";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import {
  HOME_NAV_ITEM,
  PRIMARY_NAV_ITEMS,
  SETTINGS_NAV_SECTIONS,
} from "./settings-nav";

interface Command {
  id: string;
  label: string;
  /** Group heading shown above the row. */
  group: string;
  icon: LucideIcon;
  /** Extra words matched by the filter but not displayed. */
  keywords?: string;
  run: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const { theme, setTheme } = useTheme();
  const { githubUser, clearGitHubUser } = useGitHubIdentity();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Global ⌘K / Ctrl+K toggle. Ignored while typing elsewhere is fine —
  // the chord is modifier-gated so it can't collide with text input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Programmatic open — lets the sidebar search bar (or any other surface)
  // raise the palette without prop-drilling its open state.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    document.addEventListener("kody:open-command-palette", onOpen);
    return () =>
      document.removeEventListener("kody:open-command-palette", onOpen);
  }, []);

  // Reset transient state every time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);

  const isVibe = pathname.startsWith("/vibe");

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
      setOpen(false);
    };

    const navCommands: Command[] = [
      ...[HOME_NAV_ITEM, ...PRIMARY_NAV_ITEMS].map((item) => ({
        id: `nav:${item.href}`,
        label: item.label,
        group: "Go to",
        icon: item.icon,
        keywords: item.description,
        run: go(item.href),
      })),
      ...SETTINGS_NAV_SECTIONS.flatMap((section) =>
        section.items.map((item) => ({
          id: `nav:${item.href}`,
          label: item.label,
          group: section.title,
          icon: item.icon,
          keywords: item.description,
          run: go(item.href),
        })),
      ),
    ];

    const actionCommands: Command[] = [
      {
        id: "action:vibe",
        label: isVibe ? "Turn off Vibe" : "Turn on Vibe",
        group: "Actions",
        icon: Sparkles,
        keywords: "vibe mode toggle build",
        run: go(isVibe ? "/" : "/vibe"),
      },
      {
        id: "action:theme",
        label:
          theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        group: "Actions",
        icon: theme === "dark" ? Sun : Moon,
        keywords: "theme dark light appearance",
        run: () => {
          setTheme(theme === "dark" ? "light" : "dark");
          setOpen(false);
        },
      },
    ];

    if (githubUser) {
      actionCommands.push({
        id: "action:signout",
        label: "Sign out",
        group: "Actions",
        icon: LogOut,
        keywords: `github account ${githubUser.login}`,
        run: () => {
          clearGitHubUser();
          setOpen(false);
        },
      });
    }

    return [...navCommands, ...actionCommands];
  }, [router, isVibe, theme, setTheme, githubUser, clearGitHubUser]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Keep the highlighted row in range as the filter narrows.
  useEffect(() => {
    setSelected((i) => Math.min(i, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  // Scroll the highlighted row into view on keyboard navigation.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${selected}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[selected]?.run();
    }
  };

  // Render rows with a group heading whenever the group changes.
  let lastGroup = "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-xl p-0 gap-0 overflow-hidden top-[20%] translate-y-0"
        // The input owns focus; let Radix skip its default autofocus.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search pages and actions. Use arrow keys to navigate, Enter to run.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3">
          <Search className="w-4 h-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search pages and actions…"
            aria-label="Search pages and actions"
            className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline-flex items-center rounded border border-white/[0.12] px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div
          ref={listRef}
          className="max-h-[min(60vh,420px)] overflow-y-auto p-2"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matching commands.
            </p>
          ) : (
            filtered.map((cmd, index) => {
              const Icon = cmd.icon;
              const showGroup = cmd.group !== lastGroup;
              lastGroup = cmd.group;
              const active = index === selected;
              return (
                <div key={cmd.id}>
                  {showGroup && (
                    <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      {cmd.group}
                    </p>
                  )}
                  <button
                    type="button"
                    data-index={index}
                    onMouseMove={() => setSelected(index)}
                    onClick={() => cmd.run()}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 h-9 text-sm transition-colors",
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate flex-1 text-left">
                      {cmd.label}
                    </span>
                    {active && (
                      <CornerDownLeft className="w-3.5 h-3.5 shrink-0 opacity-60" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
