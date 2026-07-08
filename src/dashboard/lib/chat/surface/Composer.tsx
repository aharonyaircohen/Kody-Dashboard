/**
 * @fileType component
 * @domain kody
 * @pattern chat-surface
 * @ai-summary Composer region of the chat surface — pending-attachment chips,
 * injected context chips (picked preview elements — the ChatRailApi
 * `composerInjection` contract renders here), the Kody Live status dot, the
 * input row (slash-command menu, agent-mention popover, rich MarkdownEditor
 * or plain autosize textarea, trailing send/stop icon button), the terminal
 * problem line and the action row (attach, voice, clear history, report
 * issue). Extracted verbatim from KodyChat (Step 3); all state (input text,
 * slash menu, attachments, chips, voice) and every handler stay with the
 * host, wired through props. The terminal-plugin-bound elements
 * (`chatModeToggle`, `terminalBottomControls`) are host-built ReactNode slots
 * so Step 5a can move them into `plugins/terminal` without touching this
 * file's layout.
 */
"use client";

import type {
  ChangeEvent,
  ClipboardEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  SyntheticEvent,
} from "react";
import {
  Bug,
  Eraser,
  Loader2,
  MousePointerClick,
  Paperclip,
  Send,
  Square,
  X,
} from "lucide-react";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { VoiceButton } from "../../components/VoiceButton";
import { SimpleTooltip } from "../../components/SimpleTooltip";
import {
  bootPhaseLabel,
  formatElapsed,
  formatFileSize,
  getFileIcon,
} from "../../components/kody-chat-helpers";
import type { Attachment } from "../../components/kody-chat-types";
import type { LivePhase } from "../core/kody-chat-reducer";
import type { AgentId } from "../../agents";
import { ChatPluginSlot } from "./ChatPluginProvider";

/** Trailing-button role — computed by the host (spec-pinned there). */
export type ComposerAction = "send" | "start" | "stop" | "cancel";

interface ComposerProps {
  /** Current surface mode — terminal mode swaps chrome + send semantics. */
  chatMode: "ai" | "terminal";
  /** True while a turn is in flight (disables attach/voice/clear). */
  activeLoading: boolean;

  /** Pending (not yet sent) attachments — chips above the input area. */
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;

  /**
   * Injected context chips (e.g. picked preview elements). Fed by the host
   * from the ChatRailApi `composerInjection` prop — the element-picker
   * extension's frozen external contract ends at these pills.
   */
  contextChips: Array<{ id: string; label: string; context: string }>;
  onRemoveContextChip: (id: string) => void;

  /** Kody Live status dot — renders only for live agents in AI mode. */
  isKodyLive: boolean;
  interactiveState: LivePhase;
  bootElapsed: number;
  selectedAgentId: AgentId;
  interactiveTarget: { owner: string; repo: string } | null;
  liveErrorMessage: string | null | undefined;
  onRestartLive: () => Promise<void>;

  /** Composer text — owned by the host (send path reads it). */
  input: string;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Expanded AI chat renders the rich MarkdownEditor, else the textarea. */
  richComposerEnabled: boolean;
  placeholder: string;
  composerDisabled: boolean;
  /** Host input-change handler (slash trigger + autosize live there). */
  onInputChange: (
    next: string,
    caretIndex: number | null | undefined,
    textarea?: HTMLTextAreaElement | null,
  ) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** Re-evaluate the @-mention trigger on caret moves (select/click). */
  onCaretMove: (value: string, caretIndex: number | null) => void;
  /** Close slash menu + mention popover (deferred on blur). */
  onMenusClose: () => void;

  /**
   * Slash-command menu, host-built from the commands plugin (Step 5b moved
   * it into `plugins/commands`); null while closed. Open/index state and
   * keyboard nav stay with the host — the composer owns only placement,
   * same pattern as the terminal chrome nodes below.
   */
  slashCommandMenu: ReactNode;

  /** Agent @-mention popover — open when a trigger + matches exist. */
  agentMentionsOpen: boolean;
  agentMentions: ReadonlyArray<{ slug: string; title: string }>;
  agentMentionSelectedIndex: number;
  onAgentMentionHover: (index: number) => void;
  onAgentMentionSelect: (slug: string) => void;

  /** Trailing send/stop button role + inputs (host-computed, spec-pinned). */
  composerAction: ComposerAction;
  hasComposerContent: boolean;
  terminalSendDisabled: boolean | undefined;
  terminalSendBusy: boolean | undefined;
  /** `activeTerminalChrome?.inputLabel` — disabled-title fallback source. */
  terminalInputLabel: string | null | undefined;
  onSend: () => Promise<void>;
  onStop: () => void;
  onEndLiveSession: () => void;
  onStartLiveSession: () => Promise<unknown>;

  /** Problem-only terminal status line under the input row. */
  terminalProblemMessage: string | null | undefined;

  /** Hidden file input + Paperclip trigger. */
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;

  /** Voice affordance — overlay/conversation state stays with the host. */
  voiceActive: boolean;
  voiceSupported: boolean;
  onVoiceTap: () => void;
  onVoiceLongPressStart: () => void;
  onVoiceLongPressEnd: () => void;

  /** Transcript length — clear-history renders only when > 0. */
  messageCount: number;
  onClearHistory: () => void;
  onReportIssue: () => void;

  /**
   * Terminal-plugin-bound elements, host-built (Step 5a moves them into
   * `plugins/terminal`); the composer owns only their placement.
   */
  terminalBottomControls: ReactNode;
  chatModeToggle: ReactNode;
}

/**
 * Renders the chat composer: attachment + context-chip rows, then the input
 * area (live status dot, input row with slash/mention overlays and the
 * trailing send/stop button, terminal problem line, hairline, action row).
 * Presentation-only — every state mutation flows through host callbacks.
 */
export function Composer({
  chatMode,
  activeLoading,
  attachments,
  onRemoveAttachment,
  contextChips,
  onRemoveContextChip,
  isKodyLive,
  interactiveState,
  bootElapsed,
  selectedAgentId,
  interactiveTarget,
  liveErrorMessage,
  onRestartLive,
  input,
  composerTextareaRef,
  richComposerEnabled,
  placeholder,
  composerDisabled,
  onInputChange,
  onKeyDown,
  onPaste,
  onCaretMove,
  onMenusClose,
  slashCommandMenu,
  agentMentionsOpen,
  agentMentions,
  agentMentionSelectedIndex,
  onAgentMentionHover,
  onAgentMentionSelect,
  composerAction,
  hasComposerContent,
  terminalSendDisabled,
  terminalSendBusy,
  terminalInputLabel,
  onSend,
  onStop,
  onEndLiveSession,
  onStartLiveSession,
  terminalProblemMessage,
  fileInputRef,
  onFileSelect,
  voiceActive,
  voiceSupported,
  onVoiceTap,
  onVoiceLongPressStart,
  onVoiceLongPressEnd,
  messageCount,
  onClearHistory,
  onReportIssue,
  terminalBottomControls,
  chatModeToggle,
}: ComposerProps) {
  return (
    <>
      {/* Attachments preview */}
      {chatMode === "ai" && attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pb-3 sm:px-4">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-body-xs"
            >
              {getFileIcon(attachment.mimeType)}
              <span className="max-w-[100px] truncate">{attachment.name}</span>
              <span className="text-muted-foreground">
                {formatFileSize(attachment.size)}
              </span>
              <button
                onClick={() => onRemoveAttachment(attachment.id)}
                className="ml-1 hover:text-destructive"
                disabled={activeLoading}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Context chips (e.g. picked preview elements) — compact removable
        pills; the full element details ride along on send, not in the box. */}
      {chatMode === "ai" && contextChips.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pb-3 sm:px-4">
          {contextChips.map((chip) => (
            <div
              key={chip.id}
              className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/15 px-3 py-1.5 font-mono text-body-xs text-blue-300"
              title={chip.context}
            >
              <MousePointerClick className="w-3 h-3 shrink-0" />
              <span className="max-w-[180px] truncate">{chip.label}</span>
              <button
                type="button"
                onClick={() => onRemoveContextChip(chip.id)}
                className="ml-0.5 hover:text-destructive"
                aria-label="Remove element context"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="relative z-10 shrink-0 border-t bg-background px-2.5 py-3 sm:p-4">
        <div>
          {/* Kody Live status dot — compact indicator above the composer.
            Color encodes state; hover for full detail + links. Restart
            affordance only surfaces on stuck/error. */}
          {chatMode === "ai" && isKodyLive ? (
            <div className="mb-1 flex items-center gap-2">
              <SimpleTooltip
                content={(() => {
                  if (interactiveState === "booting") {
                    const phase = bootPhaseLabel(
                      bootElapsed,
                      selectedAgentId === "kody-live-fly" ? "fly" : "gh",
                    );
                    const elapsed = formatElapsed(bootElapsed);
                    const watch =
                      interactiveTarget && selectedAgentId !== "kody-live-fly"
                        ? ` · watching ${interactiveTarget.owner}/${interactiveTarget.repo}`
                        : "";
                    return `${phase} · ${elapsed} elapsed${watch}`;
                  }
                  if (interactiveState === "ready") {
                    return "Live runner ready. Chat normally — clear the box and hit Stop to end.";
                  }
                  if (interactiveState === "awaiting") {
                    return "Live runner is processing — waiting for reply...";
                  }
                  if (
                    interactiveState === "stuck" ||
                    interactiveState === "error"
                  ) {
                    return liveErrorMessage
                      ? `Runner stuck — ${liveErrorMessage}`
                      : "Runner stuck — click Restart.";
                  }
                  if (interactiveState === "ended") {
                    return "Live runner ended. Start a new session to chat.";
                  }
                  return "Live runner is offline. Start it to enable chat.";
                })()}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    interactiveState === "ready"
                      ? "bg-green-500"
                      : interactiveState === "booting" ||
                          interactiveState === "awaiting"
                        ? "animate-pulse bg-yellow-500"
                        : interactiveState === "stuck" ||
                            interactiveState === "error"
                          ? "bg-red-500"
                          : "bg-muted-foreground/50"
                  }`}
                  aria-label={`Live runner: ${interactiveState}`}
                />
              </SimpleTooltip>
              {interactiveState === "stuck" || interactiveState === "error" ? (
                <button
                  type="button"
                  onClick={() => void onRestartLive()}
                  className="rounded-md bg-red-600/90 px-3 py-1 text-body-xs font-medium text-white hover:bg-red-700"
                >
                  Restart
                </button>
              ) : null}
            </div>
          ) : null}
          {/* Composer input row (issue #131): the textarea and a single
            trailing send/stop icon button share this row, with the
            button swapped by state. The action row below (Paperclip,
            VoiceButton) no longer hosts the send affordance — the
            hairline separates input from action rows. */}
          <div
            className={`flex items-center gap-2 ${
              chatMode === "terminal" ? "border-b border-border/40 pb-2" : ""
            }`}
          >
            <div className="flex-1 relative">
              {slashCommandMenu}
              {agentMentionsOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-2 rounded-md border border-white/10 bg-zinc-900/95 backdrop-blur-sm shadow-xl overflow-hidden max-h-64 overflow-y-auto">
                  <ul role="listbox" className="py-1">
                    {agentMentions.map((agent, idx) => {
                      const isSelected = idx === agentMentionSelectedIndex;
                      return (
                        <li
                          key={agent.slug}
                          role="option"
                          aria-selected={isSelected}
                          onMouseEnter={() => onAgentMentionHover(idx)}
                          onMouseDown={(e: MouseEvent<HTMLLIElement>) => {
                            e.preventDefault();
                            onAgentMentionSelect(agent.slug);
                          }}
                          className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 ${
                            isSelected
                              ? "bg-white/[0.08]"
                              : "hover:bg-white/[0.04]"
                          }`}
                        >
                          <span className="font-mono text-code-sm text-white/90">
                            @{agent.slug}
                          </span>
                          <span className="truncate text-body-xs text-white/55">
                            {agent.title}
                          </span>
                          <span className="ml-auto shrink-0 rounded bg-emerald-500/15 px-2 py-1 text-label uppercase tracking-wide text-emerald-300/80">
                            Agent
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="border-t border-white/[0.06] px-3 py-2 text-body-xs text-white/35">
                    ↑↓ navigate · Enter/Tab select · Esc close
                  </div>
                </div>
              )}
              {richComposerEnabled ? (
                <MarkdownEditor
                  value={input}
                  onChange={(next, event) =>
                    onInputChange(
                      next,
                      event?.target.selectionStart ??
                        composerTextareaRef.current?.selectionStart ??
                        next.length,
                    )
                  }
                  onKeyDown={onKeyDown}
                  onSelect={(e: SyntheticEvent<HTMLTextAreaElement>) => {
                    onCaretMove(
                      e.currentTarget.value,
                      e.currentTarget.selectionStart,
                    );
                  }}
                  onClick={(e: MouseEvent<HTMLTextAreaElement>) => {
                    onCaretMove(
                      e.currentTarget.value,
                      e.currentTarget.selectionStart,
                    );
                  }}
                  onPaste={onPaste}
                  onBlur={() => {
                    // Small delay so the menu's onMouseDown can fire before
                    // close — onMouseDown uses preventDefault to avoid blur,
                    // but defensive close keeps stale menus from hanging.
                    setTimeout(() => {
                      onMenusClose();
                    }, 120);
                  }}
                  placeholder={placeholder}
                  rows={5}
                  disabled={composerDisabled}
                  textareaRef={composerTextareaRef}
                  textareaClassName="min-h-[104px] max-h-[36vh]"
                  className="min-w-0"
                />
              ) : (
                <textarea
                  ref={composerTextareaRef}
                  value={input}
                  onChange={(e) => {
                    onInputChange(
                      e.target.value,
                      e.target.selectionStart,
                      e.target,
                    );
                  }}
                  onKeyDown={onKeyDown}
                  onSelect={(e) => {
                    onCaretMove(
                      e.currentTarget.value,
                      e.currentTarget.selectionStart,
                    );
                  }}
                  onClick={(e) => {
                    onCaretMove(
                      e.currentTarget.value,
                      e.currentTarget.selectionStart,
                    );
                  }}
                  onPaste={onPaste}
                  onBlur={() => {
                    // Small delay so the menu's onMouseDown can fire before
                    // close — onMouseDown uses preventDefault to avoid blur,
                    // but defensive close keeps stale menus from hanging.
                    setTimeout(() => {
                      onMenusClose();
                    }, 120);
                  }}
                  placeholder={placeholder}
                  rows={1}
                  dir="auto"
                  aria-label={
                    chatMode === "terminal"
                      ? "Terminal command input"
                      : undefined
                  }
                  className={`w-full px-3 py-2 text-base rounded-md border focus:outline-none focus:ring-1 resize-none overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed ${
                    chatMode === "terminal"
                      ? "border-border bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring"
                      : "bg-background focus:ring-primary"
                  }`}
                  disabled={composerDisabled}
                  style={{ height: "auto" }}
                />
              )}
            </div>
            {/* Trailing send/stop icon button — single role that swaps by
              state (issue #131 refinement):
                * Idle / no in-flight run → paper-plane Send icon
                * In-flight run (loading or stop/cancel) → Square stop icon
              Replaces both the old red `bg-destructive` Stop text button
              in the input row and the inline Send button that used to
              live in the action row below. The button is hidden when
              there's no content and the agent isn't Kody-Live, matching
              the previous "no send affordance when empty" behavior. */}
            {(() => {
              const isInFlight =
                chatMode === "ai" &&
                (activeLoading ||
                  composerAction === "stop" ||
                  composerAction === "cancel");
              const showTrailingButton =
                chatMode === "terminal"
                  ? hasComposerContent
                  : isInFlight
                    ? true
                    : hasComposerContent || isKodyLive;
              if (!showTrailingButton) return null;
              const title =
                chatMode === "terminal"
                  ? terminalSendDisabled
                    ? (terminalInputLabel ?? "Input unavailable")
                    : terminalSendBusy
                      ? "Sending command"
                      : "Send command"
                  : isInFlight
                    ? composerAction === "cancel"
                      ? "Cancel boot"
                      : "Stop run"
                    : composerAction === "start"
                      ? "Boot runner"
                      : "Send message";
              return (
                <button
                  type="button"
                  disabled={terminalSendDisabled}
                  onClick={() => {
                    if (chatMode === "terminal") {
                      void onSend();
                    } else if (activeLoading) {
                      onStop();
                    } else if (
                      composerAction === "stop" ||
                      composerAction === "cancel"
                    ) {
                      onEndLiveSession();
                    } else if (composerAction === "start") {
                      void onStartLiveSession();
                    } else {
                      void onSend();
                    }
                  }}
                  className={`p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    richComposerEnabled ? "mb-1 self-end" : ""
                  }`}
                  title={title}
                  aria-label={title}
                >
                  {isInFlight ? (
                    <Square className="w-5 h-5" fill="currentColor" />
                  ) : terminalSendBusy ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              );
            })()}
          </div>
          {terminalProblemMessage && (
            <div className="mt-1 text-[11px] text-amber-600" role="status">
              {terminalProblemMessage}
            </div>
          )}
          {chatMode === "ai" && <div className="border-t border-border/40" />}
        </div>
        <div
          className={`flex min-h-10 items-center gap-2 ${
            chatMode === "terminal" ? "pt-2" : ""
          }`}
        >
          {/* Plugin composer-leading slot (Step 4) — start of the action
            row; renders nothing (no wrapper) with zero plugins. */}
          <ChatPluginSlot slot="composer-leading" />
          {chatMode === "ai" && (
            <>
              {/* Attachment button — hidden file input lives alongside the
                Paperclip so the picker click handler still targets the
                same ref. */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.txt,.md,.json,.js,.ts,.jsx,.tsx,.html,.css,.scss,.yaml,.yml,.sh"
                onChange={onFileSelect}
                className="hidden"
                disabled={activeLoading}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={activeLoading}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                title="Attach files"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              {/* Voice button — gated on `agent.supportsVoice`. Each agent
                declares whether its backend can honor the voice overlay
                (see AgentConfig.supportsVoice). Brain agents support it
                once the brain server applies the overlay server-side;
                kody-live/engine agents don't (latency). The mic stays
                hidden for unsupported agents so the dropdown never lies. */}
              <VoiceButton
                isActive={voiceActive}
                isSupported={voiceSupported}
                onTap={onVoiceTap}
                onLongPressStart={onVoiceLongPressStart}
                onLongPressEnd={onVoiceLongPressEnd}
                disabled={activeLoading}
              />
              {messageCount > 0 && !activeLoading && (
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                  title="Clear history"
                  aria-label="Clear history"
                >
                  <Eraser className="w-5 h-5" aria-hidden="true" />
                </button>
              )}
              <div className="flex-1" />
            </>
          )}
          {chatMode === "terminal" && terminalBottomControls}
          {chatMode === "terminal" && <div className="flex-1" />}
          {chatMode === "terminal" && (
            <button
              type="button"
              onClick={onReportIssue}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600 transition-colors hover:border-red-300 hover:bg-red-100 hover:text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
              title="Report issue to Kody"
              aria-label="Report issue to Kody"
            >
              <Bug className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {chatMode === "terminal" && chatModeToggle}
          {chatMode === "ai" && <div className="flex-1" />}
          {chatMode === "ai" && (
            <button
              type="button"
              onClick={onReportIssue}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600 transition-colors hover:border-red-300 hover:bg-red-100 hover:text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
              title="Report issue to Kody"
              aria-label="Report issue to Kody"
            >
              <Bug className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {chatMode === "ai" && chatModeToggle}
          {/* Plugin composer-actions slot (Step 4) — end of the action
            row; renders nothing (no wrapper) with zero plugins. */}
          <ChatPluginSlot slot="composer-actions" />
        </div>
      </div>
    </>
  );
}
