/**
 * @fileType component
 * @domain kody
 * @pattern chat-surface
 * @ai-summary Sessions panel region of the chat surface — click-to-close
 * scrim plus the SessionSidebar with its pinned / overlay / rail-fullscreen
 * positioning variants. Extracted verbatim from KodyChat (Step 3); state
 * (open/pinned + localStorage persistence) stays with the host.
 */
"use client";

import { SessionSidebar } from "../../components/SessionSidebar";
import type { SessionMeta } from "../../chat-types";

interface SessionsPanelProps {
  /** Whether the panel is open (host-owned state). */
  open: boolean;
  /** Sessions UI only exists in global chat mode. */
  isGlobalMode: boolean;
  /** Pinned-open state (host-owned, persisted by the host). */
  pinned: boolean;
  /** True when the chat is in /chat fullscreen mode. */
  railFullscreen?: boolean;
  /** presentation="standalone" drops the border/shadow on the overlay. */
  standalonePresentation: boolean;
  sessions: SessionMeta[];
  activeSessionId: string | null;
  modeBySessionId?: Record<string, "ai" | "terminal">;
  onSwitchSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onPinSession: (sessionId: string) => void;
  onTogglePinned?: () => void;
  onClose: () => void;
}

/**
 * Renders the sessions panel region: an invisible full-surface scrim (click
 * to close, only in the unpinned overlay variant) and the SessionSidebar
 * itself. Returns a fragment so the absolutely-positioned children keep
 * anchoring to the host's relative container.
 */
export function SessionsPanel({
  open,
  isGlobalMode,
  pinned,
  railFullscreen,
  standalonePresentation,
  sessions,
  activeSessionId,
  modeBySessionId,
  onSwitchSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onPinSession,
  onTogglePinned,
  onClose,
}: SessionsPanelProps) {
  if (!open || !isGlobalMode) return null;

  return (
    <>
      {!pinned && (
        <button
          type="button"
          aria-label="Close conversations"
          onClick={onClose}
          className={`absolute inset-0 z-40 cursor-default bg-black/20 ${
            railFullscreen ? "md:hidden" : ""
          }`}
        />
      )}
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSwitchSession={onSwitchSession}
        onCreateSession={onCreateSession}
        onDeleteSession={onDeleteSession}
        onRenameSession={onRenameSession}
        onPinSession={onPinSession}
        modeBySessionId={modeBySessionId}
        pinnedOpen={pinned}
        onTogglePinnedOpen={onTogglePinned}
        onClose={onClose}
        fullscreen={railFullscreen}
        className={
          railFullscreen
            ? "absolute start-0 top-0 bottom-0 z-50 w-[min(20rem,calc(100vw-3rem))] max-w-full shadow-lg md:relative md:z-10 md:w-80 md:min-w-0 md:basis-80 md:shrink md:shadow-none"
            : `absolute start-0 top-0 bottom-0 w-full sm:w-72 z-50 ${
                standalonePresentation ? "border-r-0 shadow-none" : "shadow-lg"
              }`
        }
      />
    </>
  );
}
