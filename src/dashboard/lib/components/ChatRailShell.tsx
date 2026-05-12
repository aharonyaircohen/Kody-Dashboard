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
 *   The rail is hidden on /login (the only public route) and while
 *   `useAuth().loading` is true, to avoid flashing the chrome before
 *   auth resolves. Mobile mode swaps the desktop aside for a floating
 *   action button and a right-side Sheet.
 */
"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { usePathname } from "next/navigation"
import { MessageSquare, X as XIcon } from "lucide-react"
import { Button } from "@dashboard/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@dashboard/ui/sheet"
import { KodyChat } from "./KodyChat"
import { Sidebar } from "./Sidebar"
import { useAuth } from "../auth-context"
import { useGitHubIdentity } from "../hooks/useGitHubIdentity"
import type { ChatContext } from "../chat-types"
import { cn } from "../utils"

interface ChatRailApi {
  scope: ChatContext | null
  setScope: (next: ChatContext | null) => void
  /** Programmatically open the mobile chat sheet (e.g. from an error state). */
  openMobileChat: () => void
}

const ChatRailContext = createContext<ChatRailApi | null>(null)

/**
 * Read & control the persistent chat. Returns a no-op API when called
 * outside the rail (e.g. on /login or before auth loads) so callers
 * don't need to special-case it.
 */
export function useChatScope(): ChatRailApi {
  return useContext(ChatRailContext) ?? NOOP_API
}

const NOOP_API: ChatRailApi = {
  scope: null,
  setScope: () => {},
  openMobileChat: () => {},
}

// Routes that must NOT render the chat rail — public surface only.
const PUBLIC_ROUTE_PREFIXES = ["/login"]

function isPublicRoute(pathname: string | null): boolean {
  if (!pathname) return false
  return PUBLIC_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

export function ChatRailShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { auth, loading } = useAuth()
  const { githubUser } = useGitHubIdentity()
  const [scope, setScope] = useState<ChatContext | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Hydration guard: SSR has no localStorage so `auth` is always null on
  // the server. Without this flag the first client render would diverge
  // from the server HTML and React would bail out with hydration error
  // #418. We force the first client paint to match the server (no rail),
  // then flip on a layout effect so the rail appears immediately.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  const openMobileChat = useCallback(() => setMobileOpen(true), [])

  const api = useMemo<ChatRailApi>(
    () => ({ scope, setScope, openMobileChat }),
    [scope, openMobileChat],
  )

  // No rail on /login, before hydration, or while auth is still loading.
  // AuthGuard inside protected pages handles the redirect for unauth'd users.
  const showRail =
    hydrated && !loading && !!auth && !isPublicRoute(pathname)

  if (!showRail) {
    return (
      <ChatRailContext.Provider value={api}>
        {children}
      </ChatRailContext.Provider>
    )
  }

  // Vibe page locks the chat to Kody Live — the agent picker is hidden
  // and the rail can't drift onto Gemini/Brain (which can't edit code).
  const isVibeRoute = pathname?.startsWith('/vibe') ?? false
  const lockedAgentId = isVibeRoute ? 'kody-live' : undefined

  return (
    <ChatRailContext.Provider value={api}>
      <div className="h-screen flex overflow-hidden bg-background text-foreground">
        {/* Desktop chat rail — hidden below md. */}
        <aside
          className="hidden md:flex flex-col shrink-0 border-r border-border bg-black/20 w-[400px]"
          aria-label="Kody chat"
        >
          <KodyChat
            context={scope}
            actorLogin={githubUser?.login}
            lockedAgentId={lockedAgentId}
            vibeMode={isVibeRoute}
          />
        </aside>

        {/* Primary navigation. */}
        <Sidebar />

        {/* Page content. Pages own their own internal scroll. */}
        <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
          {children}
        </div>
      </div>

      {/* Mobile chat FAB — only shows below md. */}
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

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 flex flex-col"
        >
          <SheetHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between space-y-0">
            <SheetTitle className="text-sm font-semibold">Chat</SheetTitle>
            <SheetDescription className="sr-only">
              Kody assistant chat
            </SheetDescription>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close chat"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            {mobileOpen ? (
              <KodyChat
                context={scope}
                actorLogin={githubUser?.login}
                onClose={() => setMobileOpen(false)}
                lockedAgentId={lockedAgentId}
                vibeMode={isVibeRoute}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </ChatRailContext.Provider>
  )
}
