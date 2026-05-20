/**
 * @fileType component
 * @domain layout
 * @pattern chat-rail-shell
 * @ai-summary Root-level chrome that owns ONE persistent <KodyChat /> for
 *   the entire authenticated dashboard. Pages render as `{children}` and
 *   push their chat context up via `useChatScope()`. The chat instance
 *   stays mounted across every navigation — scroll position, streaming
 *   state, and message history all persist.
 *
 *   The rail is hidden while `useAuth().loading` is true or when no
 *   credentials are stored, since the chat itself needs a PAT to function.
 *   In that state the dashboard's AuthGuard renders the RepoManager
 *   empty-state in place of the page. Mobile mode swaps the desktop aside
 *   for a floating action button and a right-side Sheet.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { MessageSquare, PanelLeft } from "lucide-react";
import { Button } from "@dashboard/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@dashboard/ui/sheet";
import { KodyChat } from "./KodyChat";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { SettingsDrawerProvider } from "./SettingsDrawer";
import { NotificationsProvider } from "../notifications/NotificationsProvider";
import { useAuth } from "../auth-context";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useGoals } from "../hooks/useGoals";
import type { ChatContext } from "../chat-types";
import { cn } from "../utils";

interface ChatRailApi {
  scope: ChatContext | null;
  setScope: (next: ChatContext | null) => void;
  /** Programmatically open the mobile chat sheet (e.g. from an error state). */
  openMobileChat: () => void;
  /**
   * Register a listener that fires when a chat tool creates a new issue
   * (`create_*`, `report_bug`). The chat will have already migrated the
   * running conversation to that issue's chat store by the time this
   * fires — the host typically just navigates (e.g. updates the URL's
   * `?issue=N` param on the Vibe page) so the user lands on the new
   * issue and sees the transferred history.
   *
   * Pass `null` to unregister (e.g. on unmount).
   */
  setOnIssueCreated: (cb: ((issueNumber: number) => void) | null) => void;
}

const ChatRailContext = createContext<ChatRailApi | null>(null);

/**
 * Read & control the persistent chat. Returns a no-op API when called
 * outside the rail (e.g. before auth loads or while the RepoManager
 * empty-state is shown) so callers don't need to special-case it.
 */
export function useChatScope(): ChatRailApi {
  return useContext(ChatRailContext) ?? NOOP_API;
}

const NOOP_API: ChatRailApi = {
  scope: null,
  setScope: () => {},
  openMobileChat: () => {},
  setOnIssueCreated: () => {},
};

// Routes that must NOT render the chat rail (none currently — the rail
// is gated on `auth` instead, so unauth users see no rail anywhere).
const PUBLIC_ROUTE_PREFIXES: readonly string[] = [];

function isPublicRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function ChatRailShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { auth, loading } = useAuth();
  const { githubUser } = useGitHubIdentity();
  const [scope, setScope] = useState<ChatContext | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Goals power the "direct chat to a goal by id" flow: a user types the
  // goal's `#<discussionNumber>` (or `goal:<n>`) in the composer and the
  // chat re-scopes to that goal's planner. The rail owns this (not the
  // dashboard page) so it works from any route — chat is always mounted
  // here. We pass the live goals straight down; the parser resolves the
  // number/slug to a canonical id.
  const { data: goalsData } = useGoals();
  const goals = useMemo(() => goalsData ?? [], [goalsData]);
  const directToGoal = useCallback(
    (goalId: string) => {
      const goal = goals.find((g) => g.id === goalId);
      if (!goal) return;
      const sessionId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `planner-${Date.now()}`;
      setScope({
        kind: "goal-planner",
        goal,
        sessionId,
        onExit: () => setScope(null),
      });
    },
    [goals],
  );

  // Desktop chat rail sizing. `collapsed` shrinks the aside to zero width
  // (KodyChat stays mounted — see file docstring — so streaming/scroll
  // state survives) and surfaces a floating reopen button. `fullscreen`
  // grows the aside to full width, pushing the page to 0 width. Persisted
  // per-browser so the user's preference sticks across reloads.
  const [railMode, setRailMode] = useState<
    "collapsed" | "normal" | "fullscreen"
  >("normal");
  useEffect(() => {
    const saved = localStorage.getItem("kody:rail-mode");
    if (saved === "collapsed" || saved === "fullscreen" || saved === "normal") {
      setRailMode(saved);
    }
  }, []);
  const updateRailMode = useCallback(
    (next: "collapsed" | "normal" | "fullscreen") => {
      setRailMode(next);
      localStorage.setItem("kody:rail-mode", next);
    },
    [],
  );

  // Drag-to-resize width (px) for the rail in `normal` mode. Clamped so
  // the user can't drag it off-screen or thinner than the composer needs.
  const RAIL_MIN = 320;
  const RAIL_MAX = 900;
  const [railWidth, setRailWidth] = useState(400);
  useEffect(() => {
    const saved = Number(localStorage.getItem("kody:rail-width"));
    if (saved >= RAIL_MIN && saved <= RAIL_MAX) setRailWidth(saved);
  }, []);
  const [dragging, setDragging] = useState(false);
  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setDragging(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      const onMove = (ev: PointerEvent) => {
        const next = Math.min(
          RAIL_MAX,
          Math.max(RAIL_MIN, Math.round(ev.clientX)),
        );
        setRailWidth(next);
      };
      const onUp = () => {
        setDragging(false);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setRailWidth((w) => {
          localStorage.setItem("kody:rail-width", String(w));
          return w;
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [],
  );

  // Hydration guard: SSR has no localStorage so `auth` is always null on
  // the server. Without this flag the first client render would diverge
  // from the server HTML and React would bail out with hydration error
  // #418. We force the first client paint to match the server (no rail),
  // then flip on a layout effect so the rail appears immediately.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const openMobileChat = useCallback(() => setMobileOpen(true), []);

  // Ref, not state, so registering/unregistering doesn't re-render the
  // entire app tree under the rail. The KodyChat instance reads the
  // current value through a stable proxy callback wired below.
  const onIssueCreatedRef = useRef<((issueNumber: number) => void) | null>(
    null,
  );
  const setOnIssueCreated = useCallback(
    (cb: ((issueNumber: number) => void) | null) => {
      onIssueCreatedRef.current = cb;
    },
    [],
  );
  // Stable wrapper passed to KodyChat — dispatches to whatever callback
  // the host has currently registered. Stable identity keeps useCallback
  // / useEffect deps inside KodyChat from churning.
  const dispatchIssueCreated = useCallback((issueNumber: number) => {
    onIssueCreatedRef.current?.(issueNumber);
  }, []);

  const api = useMemo<ChatRailApi>(
    () => ({ scope, setScope, openMobileChat, setOnIssueCreated }),
    [scope, openMobileChat, setOnIssueCreated],
  );

  // Keep the rail visible even when the user has no credentials yet —
  // the dashboard renders the RepoManager empty-state in its task pane
  // and we want the chrome (header + chat aside) to stay intact so the
  // user sees the full app shell from the first paint. The chat itself
  // is swapped for a "connect a repo" placeholder below when `auth`
  // is null, since `<KodyChat />` needs a PAT to be useful.
  const showRail = hydrated && !loading && !isPublicRoute(pathname);

  if (!showRail) {
    return (
      <ChatRailContext.Provider value={api}>
        <NotificationsProvider>
          <SettingsDrawerProvider>
            <CommandPalette />
            {children}
          </SettingsDrawerProvider>
        </NotificationsProvider>
      </ChatRailContext.Provider>
    );
  }

  // Vibe and the dashboard share one chat surface. The dropdown shows
  // the same list of models in both places — Kody Live remains the
  // default (it's the only backend that can actually edit code), but
  // the user can pick any configured LLM model for chat-only turns.
  const isVibeRoute = pathname?.startsWith("/vibe") ?? false;
  const lockedAgentId = undefined;

  return (
    <ChatRailContext.Provider value={api}>
      <NotificationsProvider>
        <SettingsDrawerProvider>
          <CommandPalette />
          <div className="h-screen flex overflow-hidden bg-background text-foreground">
            {/* Desktop chat rail — hidden below md. Width is driven by
            railMode; collapsed keeps KodyChat mounted but zero-width so
            streaming/scroll state survives the collapse. */}
            <aside
              className={cn(
                "hidden md:flex flex-col shrink-0 border-r border-border bg-black/20",
                !dragging && "transition-[width] duration-200",
                railMode === "collapsed" && "w-0 overflow-hidden border-r-0",
                railMode === "fullscreen" && "w-full",
              )}
              style={
                railMode === "normal" ? { width: railWidth } : undefined
              }
              aria-label="Kody chat"
            >
              {auth ? (
                <KodyChat
                  context={scope}
                  actorLogin={githubUser?.login}
                  lockedAgentId={lockedAgentId}
                  vibeMode={isVibeRoute}
                  onIssueCreated={dispatchIssueCreated}
                  knownGoals={goals}
                  onDirectToGoal={directToGoal}
                  onCollapseRail={() => updateRailMode("collapsed")}
                  onToggleFullscreen={() =>
                    updateRailMode(
                      railMode === "fullscreen" ? "normal" : "fullscreen",
                    )
                  }
                  railFullscreen={railMode === "fullscreen"}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center p-6">
                  <p className="text-xs text-muted-foreground text-center leading-relaxed">
                    Connect a repository to start chatting with Kody.
                  </p>
                </div>
              )}
            </aside>

            {/* Drag-to-resize handle — desktop, normal mode only. Sits
            on the seam between the chat rail and the nav sidebar. */}
            {auth && railMode === "normal" && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize chat"
                onPointerDown={startResize}
                onDoubleClick={() => {
                  setRailWidth(400);
                  localStorage.setItem("kody:rail-width", "400");
                }}
                className={cn(
                  "hidden md:block shrink-0 w-1 cursor-col-resize select-none -ml-px",
                  "hover:bg-emerald-500/40 active:bg-emerald-500/60",
                  dragging ? "bg-emerald-500/60" : "bg-transparent",
                )}
                title="Drag to resize · double-click to reset"
              />
            )}

            {/* Persistent primary-navigation rail — desktop only, sits
            to the right of the chat. The SettingsDrawer remains mounted
            for the mobile/header path; desktop kebab triggers removed. */}
            <Sidebar />

            {/* Page content. Pages own their own internal scroll. */}
            <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
              {children}
            </div>
          </div>

          {/* Desktop reopen button — only shows when the rail is
          collapsed (md and up). */}
          {auth && railMode === "collapsed" && (
            <Button
              type="button"
              size="icon"
              onClick={() => updateRailMode("normal")}
              className={cn(
                "hidden md:flex fixed bottom-4 left-4 z-40 h-11 w-11 rounded-full shadow-lg",
                "bg-emerald-600 hover:bg-emerald-700 text-white",
              )}
              aria-label="Open chat"
              title="Open chat"
            >
              <PanelLeft className="w-5 h-5" />
            </Button>
          )}

          {/* Mobile chat FAB — only shows below md. Hidden on /messages
              because it overlaps that page's own send button (and is
              redundant: the user is already in a chat surface). */}
          {pathname?.startsWith("/messages") ? null : (
            <Button
              type="button"
              size="icon"
              onClick={openMobileChat}
              className={cn(
                "md:hidden fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full shadow-lg",
                "bg-emerald-600 hover:bg-emerald-700 text-white",
              )}
              aria-label="Open chat"
            >
              <MessageSquare className="w-5 h-5" />
            </Button>
          )}

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent
              side="right"
              hideClose
              className="w-full sm:max-w-md !p-0 !gap-0 shadow-none border-0 outline-none focus:outline-none focus-visible:outline-none flex flex-col"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Chat</SheetTitle>
                <SheetDescription>Kody assistant chat</SheetDescription>
              </SheetHeader>
              <div className="flex-1 min-h-0">
                {mobileOpen && auth ? (
                  <KodyChat
                    context={scope}
                    actorLogin={githubUser?.login}
                    onClose={() => setMobileOpen(false)}
                    lockedAgentId={lockedAgentId}
                    vibeMode={isVibeRoute}
                    onIssueCreated={dispatchIssueCreated}
                    knownGoals={goals}
                    onDirectToGoal={directToGoal}
                  />
                ) : mobileOpen ? (
                  <div className="flex-1 flex items-center justify-center p-6">
                    <p className="text-sm text-muted-foreground text-center leading-relaxed">
                      Connect a repository to start chatting with Kody.
                    </p>
                  </div>
                ) : null}
              </div>
            </SheetContent>
          </Sheet>
        </SettingsDrawerProvider>
      </NotificationsProvider>
    </ChatRailContext.Provider>
  );
}
