/**
 * @fileType component
 * @domain chat-surface
 * @pattern presentational-layout
 * @ai-summary Phase 1.6e: the chat surface's structural JSX, extracted
 *   verbatim from KodyChat's return tree. Owns the plugin provider mount,
 *   the drag-drop chrome, the "Kody is waiting" banner, and the slot
 *   arrangement (sessions panel → column: voice overlay / header / banner /
 *   messages / composer / plugin footer / dialogs). Purely presentational:
 *   every region node is BUILT BY KodyChat (so its handlers, per-session
 *   agent writes, and source-scanned literals stay in KodyChat.tsx) and
 *   arrives here as a ReactNode slot. DOM is byte-identical to the
 *   pre-extraction tree — data-testids, aria, and class strings unchanged.
 */
"use client";

import type { DragEventHandler, ReactNode } from "react";

import type { ChatPluginRegistry } from "../platform";
import { ChatPluginProvider, ChatPluginSlot } from "./ChatPluginProvider";

interface ChatSurfaceLayoutProps {
  /** Per-mount plugin registry (plan H4) — provider is inert with no plugins. */
  pluginRegistry: ChatPluginRegistry;
  /** Host context snapshot handed to slot components (read-only). */
  pluginHost: Readonly<Record<string, unknown>>;
  standalonePresentation: boolean;
  isDraggingFile: boolean;
  onDragEnter: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  /** <SessionsPanel> node built by KodyChat. */
  sessionsPanel: ReactNode;
  /** <VoiceChatOverlay> node when open, otherwise null. */
  voiceOverlay: ReactNode;
  /** <HeaderControls> node built by KodyChat. */
  header: ReactNode;
  /** True when Kody is paused waiting for user instructions. */
  showKodyWaitingBanner: boolean;
  /** Pipeline step the run paused at (rendered only when truthy). */
  kodyWaitingStep: string | undefined;
  /** <MessageList> node built by KodyChat. */
  messageList: ReactNode;
  /** <Composer> node built by KodyChat. */
  composer: ReactNode;
  /** Confirm/issue-report dialogs — state + handlers stay in KodyChat. */
  dialogs: ReactNode;
}

export function ChatSurfaceLayout({
  pluginRegistry,
  pluginHost,
  standalonePresentation,
  isDraggingFile,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  sessionsPanel,
  voiceOverlay,
  header,
  showKodyWaitingBanner,
  kodyWaitingStep,
  messageList,
  composer,
  dialogs,
}: ChatSurfaceLayoutProps) {
  return (
    // Plugin platform mount (Step 4): the provider exposes THIS mount's
    // registry to the surface pieces (HeaderControls / Composer slots and
    // the footer slot below). With no plugins the provider is inert and
    // every slot renders nothing — zero DOM diff.
    <ChatPluginProvider registry={pluginRegistry} host={pluginHost}>
      <div
        data-testid="kody-chat-root"
        className={`relative flex h-full overflow-hidden bg-background ${
          standalonePresentation ? "" : "md:border-l"
        }`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Drag overlay — visible while a file is being dragged over the chat */}
        {isDraggingFile && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-md backdrop-blur-sm">
            <div className="px-4 py-3 bg-background/90 rounded-lg shadow-lg text-base font-medium text-primary">
              Drop to attach
            </div>
          </div>
        )}
        {/* Session Sidebar */}
        {sessionsPanel}

        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Voice Chat Overlay */}
          {voiceOverlay}
          {/* Header with context — node built by KodyChat (HeaderControls). */}
          {header}

          {/* Kody waiting for instructions banner */}
          {showKodyWaitingBanner && (
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-sm text-amber-800">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
              </span>
              <span className="font-medium">
                Kody is waiting for your instructions
              </span>
              {kodyWaitingStep && (
                <span className="text-amber-600">
                  — paused at{" "}
                  <code className="bg-amber-100 px-1 rounded">
                    {kodyWaitingStep}
                  </code>
                </span>
              )}
            </div>
          )}

          {/* Messages area */}
          {messageList}

          {/* Composer — node built by KodyChat (Composer). */}
          {composer}

          {/* Plugin footer slot — renders nothing until a plugin contributes. */}
          <ChatPluginSlot slot="footer" />

          {dialogs}
        </div>
      </div>
    </ChatPluginProvider>
  );
}
