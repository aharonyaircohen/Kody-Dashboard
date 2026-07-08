/**
 * @fileType component
 * @domain kody
 * @pattern chat-surface
 * @ai-summary Message transcript region of the chat surface — the scrollable
 * messages container (sticky auto-scroll + "jump to latest" pill), per-message
 * bubbles (user/assistant, per-message text direction, markdown rendering,
 * reasoning/thinking panels, rendered-view cards, message actions,
 * attachments), the typing-indicator grace window and the streaming tool-call
 * list. Extracted verbatim from KodyChat (Step 3); sending, rendered-view
 * action handling, the empty state and terminal surfaces stay with the host,
 * wired through props.
 */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { ChevronDown } from "lucide-react";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import { MessageActions } from "../../components/MessageActions";
import { MessageAttachments } from "../../components/MessageAttachments";
import { TypingIndicator } from "../../components/TypingIndicator";
import {
  ReasoningPanel,
  ThinkingPanel,
  ToolCallList,
} from "../../components/ToolCallCard";
import type { Message, ToolCall } from "../../components/kody-chat-types";
import { parseAssistantContent } from "../core/tool-call-strip";
import { softFormatUserMessageForDisplay } from "../core/user-message-format";
import {
  isRenderedViewDirective,
  type RenderedViewAction,
  type RenderedViewDirective,
} from "@dashboard/lib/chat-ui-actions";
import { RenderedViewCard } from "./RenderedViewCard";

type MessageDirection = "ltr" | "rtl" | "auto";

const LETTER_RE = /\p{L}/u;

function isRtlCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x061c ||
    codePoint === 0x200f ||
    (codePoint >= 0x0590 && codePoint <= 0x08ff) ||
    (codePoint >= 0xfb1d && codePoint <= 0xfdff) ||
    (codePoint >= 0xfe70 && codePoint <= 0xfefc)
  );
}

function getMessageDirection(text: string): MessageDirection {
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (!codePoint) continue;
    if (isRtlCodePoint(codePoint)) return "rtl";
    if (codePoint === 0x200e || LETTER_RE.test(char)) return "ltr";
  }

  return "auto";
}

interface MessageListProps {
  /** Current surface mode — terminal mode swaps the container chrome. */
  chatMode: "ai" | "terminal";
  /** Transcript of the active session (already mapped to UI messages). */
  messages: Message[];
  /** Host transcript setter — retry/edit/delete rewrite the message list. */
  setMessages: Dispatch<SetStateAction<Message[]>>;
  /** Resubmit a user turn after retry/edit trimmed the transcript. */
  onResend: (content: string) => void;
  /** True while a turn is in flight (streaming or awaiting first byte). */
  activeLoading: boolean;
  /** Display name for the typing indicator label. */
  agentName: string;
  /** Active session id — scopes the thinking/reasoning persist keys. */
  activeSessionId: string | undefined;
  /** Streaming tool calls not yet folded into a message. */
  toolCalls: ToolCall[];
  /** Rendered-view ids already consumed (locks the card after click). */
  usedViewIds: Set<string>;
  /** Host handler for rendered-view card actions. */
  onRenderedViewAction: (
    view: RenderedViewDirective,
    action: RenderedViewAction,
  ) => void;
  /** Mode-specific empty-transcript content, shown when no messages exist. */
  emptyState: ReactNode;
  /** Mounted terminal surfaces, rendered inside the scroll container. */
  terminalSurfaces: ReactNode;
}

export function MessageList({
  chatMode,
  messages,
  setMessages,
  onResend,
  activeLoading,
  agentName,
  activeSessionId,
  toolCalls,
  usedViewIds,
  onRenderedViewAction,
  emptyState,
  terminalSurfaces,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    setIsAtBottom(true);
  }, []);

  // Track whether the user is pinned to the bottom. We only auto-scroll on new
  // content when they are — otherwise scrolling up to read history would fight
  // every streamed token. Threshold is generous (80px) to account for the
  // input bar and "new messages" pill overlap.
  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsAtBottom(distanceFromBottom < 80);
  }, []);

  useEffect(() => {
    if (isAtBottom) scrollToBottom();
  }, [messages, activeLoading, isAtBottom, scrollToBottom]);

  // 800ms grace period for the typing indicator (issue #330). The agentIdentity
  // tells the model to emit a short status line (≤8 words) as the very first
  // word of every reply so the bubble is never blank. The grace timer is the
  // UI backstop for that prompt — if the model is still silent after 800ms
  // (engine first-byte lag, slow cold start, no status line), we surface the
  // existing TypingIndicator. The moment the first visible token lands, the
  // per-bubble `!hasAnswer` check hides it again. Resets on every new turn
  // (any change in `activeLoading`).
  const [showTypingAfterGrace, setShowTypingAfterGrace] = useState(false);
  useEffect(() => {
    if (!activeLoading) {
      setShowTypingAfterGrace(false);
      return;
    }
    setShowTypingAfterGrace(false);
    const t = setTimeout(() => setShowTypingAfterGrace(true), 800);
    return () => clearTimeout(t);
  }, [activeLoading]);

  return (
    <>
      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className={`flex-1 min-h-0 relative ${
          chatMode === "terminal"
            ? "overflow-hidden bg-[#050608]"
            : "overflow-auto px-1.5 py-2 sm:p-4 space-y-4"
        }`}
      >
        {chatMode === "ai" &&
          messages.length === 0 &&
          !activeLoading &&
          emptyState}

        {terminalSurfaces}

        {chatMode === "ai" &&
          messages.map((msg, i) => {
            if (msg.hidden) return null;

            const parsedAssistant =
              msg.role === "assistant"
                ? parseAssistantContent(msg.content)
                : null;
            const visibleText = parsedAssistant?.answer || msg.content;
            const messageDirection = getMessageDirection(visibleText);

            return (
              <div
                key={i}
                data-role={msg.role}
                className={`group flex ${msg.role === "user" ? "justify-end" : "justify-start"} relative`}
              >
                <div
                  dir={messageDirection}
                  className={`max-w-[92%] sm:max-w-[85%] min-w-0 break-words rounded-lg px-3 py-2 text-[17px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {/* Message Actions */}
                  <MessageActions
                    role={msg.role}
                    content={msg.content}
                    isLast={i === messages.length - 1}
                    isLoading={!!msg.isLoading}
                    hasToolCalls={!!msg.toolCalls && msg.toolCalls.length > 0}
                    onCopy={() => msg.content}
                    onRetry={
                      msg.role === "assistant" && i === messages.length - 1
                        ? () => {
                            // Walk back to the last user message. Drop both that
                            // user turn AND the failed assistant reply — sendText
                            // pushes a fresh user bubble, so trimming both keeps
                            // the transcript intact (no duplicate user msg).
                            let userIdx = -1;
                            for (let j = i - 1; j >= 0; j--) {
                              if (messages[j].role === "user") {
                                userIdx = j;
                                break;
                              }
                            }
                            if (userIdx < 0) return;
                            const lastUserContent = messages[userIdx].content;
                            setMessages((prev) => prev.slice(0, userIdx));
                            onResend(lastUserContent);
                          }
                        : undefined
                    }
                    onEdit={
                      msg.role === "user"
                        ? (content) => {
                            // Drop the edited user msg + everything after it,
                            // then resubmit. sendText repushes the user bubble
                            // with the new content, so we don't keep the old one.
                            setMessages((prev) => prev.slice(0, i));
                            onResend(content);
                          }
                        : undefined
                    }
                    onDelete={() => {
                      setMessages((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                  />

                  {msg.role === "assistant" ? (
                    <>
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <ThinkingPanel
                          toolCalls={msg.toolCalls}
                          isStreaming={!!msg.isLoading}
                          persistKey={
                            activeSessionId && !msg.isLoading
                              ? `${activeSessionId}:${msg.timestamp ?? i}`
                              : undefined
                          }
                        />
                      )}
                      {(() => {
                        // Strip model-emitted tool-call markup (`<kody_run_issue />`
                        // and `<tool_call>…</tool_call>` blocks) from the visible
                        // answer — the structured call is already surfaced via
                        // the ThinkingPanel above, and the raw XML in the
                        // text stream is just noise. Bare URLs get auto-linked
                        // by `remark-gfm` below.
                        const { reasoning, answer } = parsedAssistant ?? {
                          reasoning: "",
                          answer: "",
                        };
                        const isActive =
                          activeLoading && i === messages.length - 1;
                        const hasAnswer = answer.trim().length > 0;
                        return (
                          <>
                            {reasoning && (
                              <ReasoningPanel
                                content={reasoning}
                                isStreaming={!!msg.isLoading}
                                persistKey={
                                  activeSessionId && !msg.isLoading
                                    ? `${activeSessionId}:${msg.timestamp ?? i}`
                                    : undefined
                                }
                              />
                            )}
                            {hasAnswer && (
                              <MarkdownPreview
                                content={answer}
                                dir={messageDirection}
                                className="chat-message-text prose-base break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-words"
                              />
                            )}
                            {msg.view && isRenderedViewDirective(msg.view) && (
                              <RenderedViewCard
                                view={msg.view}
                                disabled={
                                  !!msg.isLoading ||
                                  i !== messages.length - 1 ||
                                  usedViewIds.has(msg.view.id)
                                }
                                onAction={(action) =>
                                  onRenderedViewAction(
                                    msg.view as RenderedViewDirective,
                                    action,
                                  )
                                }
                              />
                            )}
                            {/* Never a blank bubble: while the turn is in flight and
                          no visible answer text has arrived yet, show the
                          thinking indicator — but only after the 800ms grace
                          timer (issue #330). The agentIdentity's status-line rule
                          should already have given the model a chance to
                          emit a first-line within that window; the indicator
                          is the backstop for when it didn't. Covers the
                          reasoning-only / tool-call phase where content is
                          just <think> blocks. */}
                            {isActive && showTypingAfterGrace && !hasAnswer && (
                              <TypingIndicator label={agentName} />
                            )}
                          </>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <MessageAttachments attachments={msg.attachments} />
                      )}
                      {msg.content && (
                        <MarkdownPreview
                          content={softFormatUserMessageForDisplay(msg.content)}
                          dir={messageDirection}
                          variant="compact"
                          className="chat-message-text prose-base break-words prose-invert prose-headings:my-1 prose-headings:text-primary-foreground prose-p:my-0 prose-p:whitespace-pre-wrap prose-p:leading-relaxed prose-p:text-primary-foreground prose-strong:text-primary-foreground prose-a:text-primary-foreground prose-a:underline prose-code:bg-primary-foreground/20 prose-code:text-primary-foreground prose-pre:bg-primary-foreground/15 prose-ul:my-1 prose-ul:text-primary-foreground prose-ol:my-1 prose-ol:text-primary-foreground prose-li:my-0 prose-li:marker:text-primary-foreground/70 prose-blockquote:my-1 prose-blockquote:text-primary-foreground prose-table:text-primary-foreground prose-th:text-primary-foreground [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-words"
                        />
                      )}
                    </>
                  )}
                  {activeLoading &&
                    i === messages.length - 1 &&
                    msg.role === "assistant" &&
                    parsedAssistant?.answer.trim() && (
                      <span className="inline-block ms-2 animate-pulse text-primary">
                        ●
                      </span>
                    )}
                </div>
              </div>
            );
          })}

        {/* Typing indicator shown before an assistant placeholder exists.
          Covers the Kody-engine first-byte window where the placeholder is
          only pushed once the first SSE event arrives. Gated on the same
          800ms grace timer as the in-bubble indicator (#330) so a fast
          model that emits the agentIdentity's status line quickly never flashes
          the typing bubble. */}
        {chatMode === "ai" &&
          activeLoading &&
          showTypingAfterGrace &&
          messages.length > 0 &&
          messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="max-w-[92%] sm:max-w-[85%] rounded-lg px-3 py-2 bg-muted">
                <TypingIndicator label={agentName} />
              </div>
            </div>
          )}

        {/* Tool calls display - using ToolCallList component */}
        {chatMode === "ai" && toolCalls.length > 0 && (
          <div className="flex justify-start">
            <ToolCallList
              toolCalls={toolCalls.map((tc) => ({
                name: tc.name,
                arguments: tc.arguments,
                result: tc.result,
                status: tc.status,
                startedAt: tc.startedAt,
                durationMs: tc.durationMs,
                description: tc.description,
              }))}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* "Jump to latest" pill — visible only when the user has scrolled up
        and is therefore not pinned to the bottom. Clicking re-engages
        sticky scrolling. */}
      {!isAtBottom && (
        <div className="relative">
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className="absolute -top-14 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-4 py-2 text-body-xs font-medium text-primary-foreground shadow-lg transition-opacity hover:opacity-90"
            aria-label="Jump to latest messages"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            {activeLoading ? "New messages" : "Jump to latest"}
          </button>
        </div>
      )}
    </>
  );
}
