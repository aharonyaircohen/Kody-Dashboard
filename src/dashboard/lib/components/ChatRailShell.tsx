/**
 * @fileType component
 * @domain layout
 * @pattern chat-rail-shell
 * @ai-summary Root-level chrome that hosts the dashboard's KodyChat. Pages
 *   render as `{children}` and push their chat context up via
 *   `useChatScope()`. KodyChat mounts TWICE: a persistent desktop instance
 *   (full pane on /chat, side rail elsewhere — hidden, not unmounted, so
 *   scroll position, streaming state, and message history persist across
 *   navigation) plus a second instance in the mobile sheet while it is
 *   open on non-chat routes. Anything host-fed (composerInjection,
 *   attachmentInjection, previewContext) reaches BOTH instances.
 *
 *   The rail is hidden while `useAuth().loading` is true or when no
 *   credentials are stored, since the chat itself needs a PAT to function.
 *   In that state the dashboard's AuthGuard renders the RepoManager
 *   empty-state in place of the page. On mobile the desktop aside is
 *   replaced by a panel that opens below the top header (no backdrop), so
 *   the header's hamburger stays reachable; it's opened from the header's
 *   chat button.
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
import { usePathname, useRouter } from "next/navigation";
import { KodyChat } from "./KodyChat";
import { AppHeader } from "./AppHeader";
import { Sidebar } from "./Sidebar";
import { RepoManager } from "./RepoManager";
import { CommandPalette } from "./CommandPalette";
import { SettingsDrawerProvider } from "./SettingsDrawer";
import { NotificationsProvider } from "../notifications/NotificationsProvider";
import { useAuth } from "../auth-context";
import { shouldPollChatGoalsForRoute } from "../github-background-polling";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useGoals } from "../hooks/useGoals";
import type { ChatContext } from "../chat-types";
import { cn } from "../utils";
import {
  legacyRepoRedirectPath,
  repoPathForNavMatching,
  repoScopedHref,
  resolveRepoRouteAuthSync,
} from "../routes";
import { routeOwnsAppHeader } from "./header-ownership";
import { terminalChatPlugin } from "../chat/plugins/terminal";
import { commandsChatPlugin } from "../chat/plugins/commands";
import { vibeChatPlugin } from "../chat/plugins/vibe";
import { goalsChatPlugin } from "../chat/plugins/goals";

// Admin plugin composition (Step 6 / M6: the HOST owns the plugin list, so
// each surface bundles only what it imports). Both KodyChat mounts (desktop
// rail + mobile sheet) register the same set under the default FULL_GRANT.
// Order matches the pre-Step-6 built-in registration order: terminal,
// commands, vibe, goals (goals last — both mounts always pass
// `onDirectToGoal`, so the pre-move conditional was always true here).
const ADMIN_CHAT_PLUGINS = [
  { plugin: terminalChatPlugin },
  { plugin: commandsChatPlugin },
  { plugin: vibeChatPlugin },
  { plugin: goalsChatPlugin },
];

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
  /**
   * Attach a context chip to the chat composer (e.g. an element picked from
   * the Vibe preview). The chat shows `label` as a removable pill and appends
   * `context` to the next outgoing message. `id` makes it idempotent. Pass
   * `null` to clear. Mirrors how PreviewModal passes `composerInjection`
   * directly — Vibe routes it through here because its chat is the rail.
   */
  setComposerInjection: (
    injection: { id: string; label: string; context: string } | null,
  ) => void;
  /**
   * Attach an image to the chat composer (e.g. a Vibe-preview screenshot).
   * Mirrors `setComposerInjection` but for the attachment list. Pass `null`
   * to clear.
   */
  setAttachmentInjection: (
    injection: {
      id: string;
      name: string;
      dataUrl: string;
      mimeType: string;
    } | null,
  ) => void;
  /**
   * Ambient context for the active preview workspace selection. The chat
   * appends this invisibly on send; pages clear it on unmount.
   */
  setPreviewContext: (context: string | null) => void;
  /** Page-level escape hatch for views that render their own top header. */
  setPageOwnsHeader: (ownsHeader: boolean) => void;
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
  setComposerInjection: () => {},
  setAttachmentInjection: () => {},
  setPreviewContext: () => {},
  setPageOwnsHeader: () => {},
};

// Routes that must NOT render the dashboard rail. Client chat owns its own
// full-page shell and must not inherit admin dashboard chrome.
const PUBLIC_ROUTE_PREFIXES: readonly string[] = ["/client"];

function isPublicRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function ChatRailShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const publicRoute = isPublicRoute(pathname);
  const { auth, loading, setCurrentRepo } = useAuth();
  const { githubUser } = useGitHubIdentity();
  const [scope, setScope] = useState<ChatContext | null>(null);
  // Mobile "chat open" — persisted per-device (same as the desktop expand
  // state) so opening chat survives a reload / navigation, not just the
  // in-memory session.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    setMobileOpen(localStorage.getItem("kody:mobile-chat-open") === "1");
  }, []);
  const setMobileOpenPersist = useCallback((next: boolean) => {
    setMobileOpen(next);
    try {
      localStorage.setItem("kody:mobile-chat-open", next ? "1" : "0");
    } catch {
      // localStorage unavailable (private mode) — non-fatal.
    }
  }, []);

  // Goals power the "direct chat to a goal by id" flow: a user types the
  // goal's `#<discussionNumber>` (or `goal:<n>`) in the composer and the
  // chat re-scopes to that goal's planner. The rail owns this (not the
  // dashboard page) so it works from any route — chat is always mounted
  // here. We pass the live goals straight down; the parser resolves the
  // number/slug to a canonical id.
  const shouldPollChatGoals =
    !publicRoute && shouldPollChatGoalsForRoute(pathname);
  const { data: goalsData } = useGoals({ enabled: shouldPollChatGoals });
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

  // Drag-to-resize width (px) for the chat side-panel on the Vibe route
  // (chat sits beside the live preview there). Clamped so the user can't
  // drag it off-screen or thinner than the composer needs.
  const RAIL_MIN = 360;
  const RAIL_MAX = 960;
  const [railWidth, setRailWidth] = useState(440);
  useEffect(() => {
    const saved = Number(localStorage.getItem("kody:rail-width"));
    if (saved >= RAIL_MIN && saved <= RAIL_MAX) setRailWidth(saved);
  }, []);
  // "Expanded chat" is the /chat route — a real page, not a cross-page
  // overlay. The expand button navigates to /chat; restore returns to the
  // page you expanded from (so browsing away from /chat just shows that
  // page — chat never hovers over it). Remembered in a ref for the session.
  const router = useRouter();

  useEffect(() => {
    if (publicRoute) return;
    if (loading || !auth || !pathname) return;
    const target = legacyRepoRedirectPath(auth, pathname);
    if (!target) return;
    router.replace(`${target}${window.location.search}${window.location.hash}`);
  }, [auth, loading, pathname, publicRoute, router]);

  const repoRouteAuthSync = publicRoute
    ? ({ status: "none" } as const)
    : resolveRepoRouteAuthSync(pathname ?? "/", auth);

  useEffect(() => {
    if (loading || repoRouteAuthSync.status !== "switch") return;
    setCurrentRepo(repoRouteAuthSync.index, {
      redirectTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    });
  }, [loading, repoRouteAuthSync, setCurrentRepo]);

  const preExpandRouteRef = useRef("/tasks");
  const currentRepoPath = repoPathForNavMatching(pathname ?? "/");
  const scopedHref = useCallback(
    (href: string) => (auth ? repoScopedHref(auth, href) : href),
    [auth],
  );
  const toggleExpandedChat = useCallback(() => {
    if (currentRepoPath === "/chat") {
      router.push(preExpandRouteRef.current || scopedHref("/tasks"));
    } else {
      preExpandRouteRef.current = pathname || scopedHref("/tasks");
      router.push(scopedHref("/chat"));
    }
  }, [currentRepoPath, pathname, router, scopedHref]);

  // Escape always exits the full /chat view, even if the chat header is
  // hidden by a layout glitch (e.g. session sidebar overflowing on a narrow
  // window). Without this the user is stuck and has to reach for the
  // browser back button.
  useEffect(() => {
    if (currentRepoPath !== "/chat") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        router.push(preExpandRouteRef.current || scopedHref("/tasks"));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [currentRepoPath, router, scopedHref]);

  const [dragging, setDragging] = useState(false);
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const railEl = (e.currentTarget as HTMLElement)
      .previousElementSibling as HTMLElement | null;
    const railLeft = railEl ? railEl.getBoundingClientRect().left : 0;
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(
        RAIL_MAX,
        Math.max(RAIL_MIN, Math.round(ev.clientX - railLeft)),
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
  }, []);

  // Hydration guard: SSR has no localStorage so `auth` is always null on
  // the server. Without this flag the first client render would diverge
  // from the server HTML and React would bail out with hydration error
  // #418. We force the first client paint to match the server (no rail),
  // then flip on a layout effect so the rail appears immediately.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const openMobileChat = useCallback(() => {
    if (!auth) {
      setMobileOpenPersist(false);
      return;
    }
    setMobileOpenPersist(true);
  }, [auth, setMobileOpenPersist]);

  useEffect(() => {
    if (!loading && !auth && mobileOpen) setMobileOpenPersist(false);
  }, [auth, loading, mobileOpen, setMobileOpenPersist]);

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

  // Composer context chip (picked Vibe-preview element) — held as state so
  // both KodyChat instances below re-render with the new chip.
  const [composerInjection, setComposerInjection] = useState<{
    id: string;
    label: string;
    context: string;
  } | null>(null);
  const [attachmentInjection, setAttachmentInjection] = useState<{
    id: string;
    name: string;
    dataUrl: string;
    mimeType: string;
  } | null>(null);
  const [previewContext, setPreviewContext] = useState<string | null>(null);
  const [pageHeaderOwnedByChild, setPageOwnsHeader] = useState(false);

  const api = useMemo<ChatRailApi>(
    () => ({
      scope,
      setScope,
      openMobileChat,
      setOnIssueCreated,
      setComposerInjection,
      setAttachmentInjection,
      setPreviewContext,
      setPageOwnsHeader,
    }),
    [scope, openMobileChat, setOnIssueCreated],
  );

  // Keep the rail visible even when the user has no credentials yet —
  // the dashboard renders the RepoManager empty-state in its task pane
  // and we want the chrome (header + chat aside) to stay intact so the
  // user sees the full app shell from the first paint. The chat itself
  // is swapped for a "connect a repo" placeholder below when `auth`
  // is null, since `<KodyChat />` needs a PAT to be useful.
  const showRail = hydrated && !loading && !publicRoute;

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

  // The desktop KodyChat stays mounted (hidden, not unmounted) so
  // history/streaming survive navigation. It renders two ways:
  //   • /chat  → full-width main pane (the primary assistant view)
  //   • else   → fixed-width side rail beside the page (tasks, vibe,
  //              settings…); on mobile non-chat it hides and a SECOND
  //              KodyChat instance mounts in the sheet opened from the
  //              header's chat button (see the fixed panel below).
  // Kody Live remains the default agent (only it can edit code); the model
  // dropdown still lets the user pick any configured LLM for chat-only turns.
  const isChatRoute = currentRepoPath === "/chat";
  const isVibeRoute =
    currentRepoPath === "/vibe" || currentRepoPath.startsWith("/vibe/");
  const isOrgRoute =
    pathname === "/org" || (pathname?.startsWith("/org/") ?? false);
  const repoRouteBlocksPage =
    repoRouteAuthSync.status === "switch" ||
    repoRouteAuthSync.status === "missing";
  // Routes whose page renders its OWN in-pane header (KodyDashboard on the
  // tasks list, new-task / report-bug modals, and issue detail at /<number>;
  // plus Vibe). The shared AppHeader must NOT render on these or two headers
  // stack. KodyDashboard mounts on all of: /tasks, /new, /bug,
  // /report-kody-bug, and /<issueNumber>(/…) — see app/. Note /bug and /new
  // are also reached mid-session via KodyDashboard's history.pushState when a
  // modal opens, so they must be listed even though no route file navigates
  // here directly.
  const pageOwnsHeader =
    !!auth &&
    !repoRouteBlocksPage &&
    (routeOwnsAppHeader(currentRepoPath) || pageHeaderOwnedByChild);
  const lockedAgentId = isOrgRoute ? "kody" : undefined;
  const pageContent =
    repoRouteAuthSync.status === "switch" ? (
      <div className="flex-1 flex items-center justify-center p-6 text-body-sm text-muted-foreground">
        Switching repository…
      </div>
    ) : repoRouteAuthSync.status === "missing" ? (
      <RepoManager />
    ) : (
      children
    );

  const chatPane = auth ? (
    <KodyChat
      context={scope}
      actorLogin={githubUser?.login}
      lockedAgentId={lockedAgentId}
      vibeMode={isVibeRoute}
      onIssueCreated={dispatchIssueCreated}
      knownGoals={goals}
      onDirectToGoal={directToGoal}
      composerInjection={composerInjection}
      attachmentInjection={attachmentInjection}
      previewContext={previewContext}
      plugins={ADMIN_CHAT_PLUGINS}
      // Expand = navigate to the /chat page; restore = back to the previous
      // page. On /chat the button reads as "restore" (railFullscreen).
      onToggleFullscreen={toggleExpandedChat}
      railFullscreen={isChatRoute}
    />
  ) : (
    <div className="flex-1 flex items-center justify-center p-6">
      <p className="text-body-sm text-muted-foreground text-center leading-relaxed">
        Connect a repository to start chatting with Kody.
      </p>
    </div>
  );

  return (
    <ChatRailContext.Provider value={api}>
      <NotificationsProvider>
        <SettingsDrawerProvider>
          <CommandPalette />
          <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
            <div className="flex-1 min-h-0 flex overflow-hidden">
              {/* Nav sidebar — far left. Chat sits to its right, so the
                order reads nav | chat | tasks. */}
              <Sidebar />

              {/* Chat rail — right of the nav sidebar. A fixed-width side
                rail by default; full-width when expanded (the chat header's
                expand button) or on /chat. Hidden on mobile non-chat (reached
                via the FAB below). Always mounted so chat history/streaming
                survive navigation. */}
              <div
                className={cn(
                  "flex-col min-h-0 min-w-0 bg-black/20",
                  isChatRoute
                    ? "flex flex-1"
                    : "hidden md:flex shrink-0 border-r border-border",
                  !dragging && "transition-[width] duration-200",
                )}
                style={!isChatRoute ? { width: railWidth } : undefined}
                aria-label="Kody chat"
              >
                {chatPane}
              </div>

              {/* Drag handle between the chat rail and the page — desktop,
                side-rail routes only (not when chat is the full /chat view). */}
              {auth && !isChatRoute && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize chat"
                  onPointerDown={startResize}
                  onDoubleClick={() => {
                    setRailWidth(440);
                    localStorage.setItem("kody:rail-width", "440");
                  }}
                  className={cn(
                    "hidden md:block shrink-0 w-1.5 cursor-col-resize select-none -ml-px",
                    "hover:bg-emerald-500/40 active:bg-emerald-500/60",
                    dragging ? "bg-emerald-500/60" : "bg-transparent",
                  )}
                  title="Drag to resize · double-click to reset"
                />
              )}

              {/* Page content. One shared header sits at the TOP OF THE
                PANE on every route — Tasks and Vibe render their own header
                inside their page; all other routes get AppHeader here — so the
                bar is consistent across pages instead of full-width on some and
                in-pane on others. Pages own their internal scroll (children
                wrapper is flex-1 below the header). Hidden on /chat, the full
                chat view. */}
              <div
                className={cn(
                  "flex-1 min-w-0 h-full overflow-hidden flex flex-col",
                  isChatRoute && "hidden",
                )}
              >
                {!pageOwnsHeader && <AppHeader />}
                <div className="flex-1 min-h-0 flex flex-col">
                  {pageContent}
                </div>
              </div>
            </div>
          </div>

          {/* Mobile chat — opens as a panel BELOW the top header (no backdrop)
          so the header stays visible and its hamburger (nav + filters) is
          still reachable while chatting. The rail is desktop-only; on mobile
          chat is opened from the header's chat button. Not shown on /chat
          (chat is the full view) or /messages (its own chat surface). */}
          {mobileOpen &&
            auth &&
            !isChatRoute &&
            !currentRepoPath.startsWith("/messages") && (
              <div className="fixed inset-x-0 bottom-0 top-16 z-30 flex flex-col border-t border-border bg-background md:hidden">
                {auth ? (
                  <KodyChat
                    context={scope}
                    actorLogin={githubUser?.login}
                    onClose={() => setMobileOpenPersist(false)}
                    lockedAgentId={lockedAgentId}
                    vibeMode={isVibeRoute}
                    onIssueCreated={dispatchIssueCreated}
                    knownGoals={goals}
                    onDirectToGoal={directToGoal}
                    composerInjection={composerInjection}
                    attachmentInjection={attachmentInjection}
                    previewContext={previewContext}
                    plugins={ADMIN_CHAT_PLUGINS}
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center p-6">
                    <p className="text-sm text-muted-foreground text-center leading-relaxed">
                      Connect a repository to start chatting with Kody.
                    </p>
                  </div>
                )}
              </div>
            )}
        </SettingsDrawerProvider>
      </NotificationsProvider>
    </ChatRailContext.Provider>
  );
}
