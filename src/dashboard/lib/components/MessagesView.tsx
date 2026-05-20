/**
 * @fileType component
 * @domain kody
 * @pattern messages-view
 * @ai-summary Team messaging surface. Left rail lists channels (`#`-titled
 *   GitHub Discussions); the main pane is the selected channel's message
 *   feed + a composer with markdown + @mention autocomplete. Messages are
 *   native discussion comments, so @mentions fan out to push/Slack/inbox for
 *   free. When Discussions are off, renders the shared disabled badge.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bold,
  ChevronDown,
  ChevronLeft,
  Code,
  ExternalLink,
  Eye,
  Hash,
  Italic,
  Link2,
  List,
  Loader2,
  MessageSquare,
  Plus,
  Send,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@dashboard/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { Textarea } from "@dashboard/ui/textarea";
import { cn } from "@dashboard/lib/utils/ui";
import {
  useMessageChannels,
  useChannelThread,
  useCreateChannel,
  useDeleteChannel,
  usePostChannelMessage,
} from "../hooks/useMessages";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useCommentAttachments } from "../hooks/useCommentAttachments";
import { AttachmentBar } from "./AttachmentBar";
import { DiscussionsDisabledBadge } from "./GoalDiscussion";
import { type GoalDiscussionComment } from "../api";
import { useMentionRoster } from "../hooks/useMentionRoster";

interface Mention {
  login: string;
  avatar_url: string;
  /** True for worker personas — mentioning one dispatches an ad-hoc tick. */
  isWorker?: boolean;
}

/** Consecutive messages from the same author within this window collapse
 *  into one visual group (Slack-style) — avatar/name shown once. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year:
      d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function MessageMarkdown({
  body,
  onPrimary,
}: {
  body: string;
  /** Rendered inside a primary-colored "my message" bubble — flip
   *  link/code colors so they stay legible on the dark fill. */
  onPrimary?: boolean;
}) {
  return (
    <div
      dir="auto"
      className={cn(
        "prose prose-sm max-w-none text-[15px] leading-relaxed break-words",
        onPrimary
          ? "prose-invert prose-p:text-primary-foreground"
          : "dark:prose-invert",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            if (!match) {
              return (
                <code
                  className={cn(
                    "px-1 py-0.5 rounded text-xs",
                    onPrimary
                      ? "bg-primary-foreground/20"
                      : "bg-muted",
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <pre
                className={cn(
                  "p-2 rounded-md overflow-x-auto",
                  onPrimary ? "bg-primary-foreground/15" : "bg-muted",
                )}
              >
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            );
          },
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "hover:underline break-all",
                  onPrimary
                    ? "text-primary-foreground underline"
                    : "text-primary",
                )}
                {...props}
              >
                {children}
              </a>
            );
          },
          img: (props) => (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img {...props} className="max-w-full h-auto rounded-md" />
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

function MessageItem({
  comment,
  highlight,
  grouped,
  isMe,
}: {
  comment: GoalDiscussionComment;
  highlight?: boolean;
  /** Part of a run from the same author — hide avatar/name. */
  grouped?: boolean;
  /** Authored by the signed-in user — render on the right in primary. */
  isMe?: boolean;
}) {
  const author = comment.author;
  const isBot = author?.login.endsWith("[bot]") ?? false;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlight && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);

  const time = new Date(comment.createdAt);
  const timeLabel = time.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      ref={ref}
      id={`msg-${comment.databaseId}`}
      className={cn(
        "group flex gap-2 px-3 scroll-mt-16",
        grouped ? "mt-0.5" : "mt-3",
        isMe ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* Avatar gutter — only on incoming messages, only first of a run. */}
      {!isMe ? (
        grouped ? (
          <div className="w-7 shrink-0" />
        ) : (
          <Avatar className="h-7 w-7 mt-auto shrink-0">
            {author?.avatarUrl ? (
              <AvatarImage src={author.avatarUrl} alt={author.login} />
            ) : null}
            <AvatarFallback className="text-[11px] bg-muted">
              {author?.login[0]?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
        )
      ) : null}

      <div
        className={cn(
          "flex flex-col max-w-[78%] sm:max-w-[68%]",
          isMe ? "items-end" : "items-start",
        )}
      >
        {!grouped && !isMe ? (
          <span className="px-1 pb-0.5 text-[13px] font-medium text-muted-foreground">
            {author?.login ?? "unknown"}
            {isBot ? (
              <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                bot
              </span>
            ) : null}
          </span>
        ) : null}
        <div
          className={cn(
            "rounded-2xl px-3 py-2 shadow-sm transition-colors",
            isMe
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border",
            // Tail: square the corner nearest the avatar/sender.
            !grouped && (isMe ? "rounded-tr-md" : "rounded-tl-md"),
            highlight && "ring-2 ring-inset ring-primary/50",
          )}
        >
          <MessageMarkdown body={comment.body} onPrimary={isMe} />
          <a
            href={comment.url}
            target="_blank"
            rel="noreferrer"
            title={time.toLocaleString()}
            className={cn(
              "mt-0.5 block text-right text-[10px] tabular-nums leading-none hover:underline",
              isMe
                ? "text-primary-foreground/70"
                : "text-muted-foreground/70",
            )}
          >
            {timeLabel}
          </a>
        </div>
      </div>
    </div>
  );
}

function MessageList({
  comments,
  highlightCommentId,
}: {
  comments: GoalDiscussionComment[];
  highlightCommentId?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Don't yank to the bottom when we're deep-linking to a specific
    // message — MessageItem scrolls that one into view instead.
    if (highlightCommentId) return;
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [comments, highlightCommentId]);

  const { githubUser } = useGitHubIdentity();
  const myLogin = githubUser?.login;

  if (comments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 bg-muted/20">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          No messages yet — say hello below.
        </p>
      </div>
    );
  }
  return (
    <div ref={ref} className="flex-1 min-h-0 overflow-y-auto bg-muted/20 py-3 pb-4">
      {comments.map((c, i) => {
        const prev = comments[i - 1];
        const sameDay = prev && dayKey(prev.createdAt) === dayKey(c.createdAt);
        const grouped =
          !!prev &&
          sameDay &&
          prev.author?.login === c.author?.login &&
          new Date(c.createdAt).getTime() -
            new Date(prev.createdAt).getTime() <
            GROUP_WINDOW_MS;
        return (
          <div key={c.id}>
            {!sameDay ? (
              <div className="flex justify-center py-3">
                <span className="rounded-full bg-background/80 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
                  {dayLabel(c.createdAt)}
                </span>
              </div>
            ) : null}
            <MessageItem
              comment={c}
              grouped={grouped}
              isMe={!!myLogin && c.author?.login === myLogin}
              highlight={
                highlightCommentId !== undefined &&
                c.databaseId === highlightCommentId
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function MessageComposer({
  channelNumber,
  channelName,
}: {
  channelNumber: number;
  channelName: string;
}) {
  const [body, setBody] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { githubUser } = useGitHubIdentity();

  const [mentionQuery, setMentionQuery] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  // Shared roster: collaborators + workers + self. Workers (e.g. @cto)
  // are offered here and in every other composer via the same hook.
  const mentions = useMentionRoster({
    login: githubUser?.login,
    avatar_url: githubUser?.avatar_url ?? undefined,
  });

  const filteredMentions = mentions
    .filter((m) => m.login.toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, 5);

  const att = useCommentAttachments();
  const hasReadyAttachment = att.attachments.some((a) => a.status === "done");

  const {
    mutate: postMessage,
    isPending,
    error,
  } = usePostChannelMessage(channelNumber, githubUser?.login);

  const canSubmit =
    (!!body.trim() || hasReadyAttachment) && !isPending && !att.isUploading;

  const handleSubmit = () => {
    if (!canSubmit) return;
    // Worker @mentions are handled server-side: the message becomes a
    // Discussion comment, the webhook detects `@worker` and dispatches the
    // one-shot worker-ask tick, and the reply lands back in this thread.
    postMessage(att.withAttachments(body.trim()), {
      onSuccess: () => {
        setBody("");
        setShowPreview(false);
        att.reset();
      },
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setBody(value);
    const before = value.slice(0, e.target.selectionStart);
    const m = before.match(/@(\w*)$/);
    if (m) {
      setMentionQuery(m[1]);
      setShowMentions(true);
      setSelectedMentionIndex(0);
    } else {
      setShowMentions(false);
      setMentionQuery("");
    }
  };

  const selectMention = (mention: Mention) => {
    const ta = textareaRef.current;
    const cursorPos = ta?.selectionStart ?? body.length;
    const before = body.slice(0, cursorPos).replace(/@\w*$/, `@${mention.login} `);
    setBody(before + body.slice(cursorPos));
    setShowMentions(false);
    setMentionQuery("");
    ta?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedMentionIndex((i) =>
            Math.min(i + 1, filteredMentions.length - 1),
          );
          return;
        case "ArrowUp":
          e.preventDefault();
          setSelectedMentionIndex((i) => Math.max(i - 1, 0));
          return;
        case "Enter":
          if (filteredMentions[selectedMentionIndex]) {
            e.preventDefault();
            selectMention(filteredMentions[selectedMentionIndex]);
          }
          return;
        case "Escape":
          setShowMentions(false);
          return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const insertMarkdown = (b: string, a = "") => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = body.slice(start, end);
    setBody(body.slice(0, start) + b + selected + a + body.slice(end));
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + b.length, start + b.length + selected.length);
    }, 0);
  };

  const toolBtn =
    "h-7 w-7 p-0 text-muted-foreground hover:text-foreground";

  return (
    <div
      className="border-t border-border bg-card/60 px-2 py-2 md:px-3 md:py-3"
      {...att.dropzoneProps}
    >
      {error ? (
        <p className="px-2 pb-1.5 text-xs text-destructive">{error.message}</p>
      ) : null}

      {showTools ? (
        <div className="flex items-center gap-0.5 px-1 pb-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => insertMarkdown("**", "**")}
            className={toolBtn}
            title="Bold"
          >
            <Bold className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => insertMarkdown("*", "*")}
            className={toolBtn}
            title="Italic"
          >
            <Italic className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => insertMarkdown("`", "`")}
            className={toolBtn}
            title="Code"
          >
            <Code className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => insertMarkdown("[", "](url)")}
            className={toolBtn}
            title="Link"
          >
            <Link2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => insertMarkdown("- ")}
            className={toolBtn}
            title="List"
          >
            <List className="w-3.5 h-3.5" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            type="button"
            variant={showPreview ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            className={cn(
              "h-7 px-2 text-xs gap-1",
              !showPreview && "text-muted-foreground hover:text-foreground",
            )}
            title={showPreview ? "Edit" : "Preview"}
          >
            <Eye className="w-3.5 h-3.5" />
            {showPreview ? "Edit" : "Preview"}
          </Button>
        </div>
      ) : null}

      {showPreview ? (
        <div
          dir="auto"
          className="mb-2 min-h-[44px] p-3 rounded-2xl bg-muted/50 text-sm prose prose-sm dark:prose-invert max-w-none"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {body || "*Nothing to preview*"}
          </ReactMarkdown>
        </div>
      ) : null}

      <div className="px-1">
        <AttachmentBar api={att} disabled={isPending} />
      </div>

      <div className="flex items-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowTools((v) => !v)}
          className={cn(
            "h-9 w-9 shrink-0 rounded-full p-0",
            showTools
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          title="Formatting"
          aria-label="Formatting options"
        >
          <Plus
            className={cn(
              "w-5 h-5 transition-transform",
              showTools && "rotate-45",
            )}
          />
        </Button>

        <div
          className={cn(
            "relative flex-1 min-w-0 rounded-3xl border bg-background transition-all",
            att.isDragging
              ? "border-primary/60 ring-2 ring-primary/30"
              : "border-border focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20",
          )}
        >
          <Textarea
            ref={textareaRef}
            value={body}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message #${channelName}`}
            rows={1}
            dir="auto"
            disabled={isPending}
            className="max-h-32 min-h-[40px] resize-none border-0 bg-transparent px-4 py-2.5 text-[15px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {showMentions ? (
            <div className="absolute bottom-full left-1 mb-2 z-50 w-72 max-h-48 overflow-y-auto rounded-xl border border-border bg-popover shadow-dropdown p-1">
              {filteredMentions.length > 0 ? (
                filteredMentions.map((mention, index) => (
                  <button
                    key={mention.login}
                    type="button"
                    onClick={() => selectMention(mention)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-lg transition-colors",
                      index === selectedMentionIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    <Avatar className="h-6 w-6">
                      {mention.avatar_url ? (
                        <AvatarImage
                          src={mention.avatar_url}
                          alt={mention.login}
                        />
                      ) : null}
                      <AvatarFallback className="text-xs bg-muted">
                        {mention.login[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm truncate">{mention.login}</span>
                    {mention.isWorker ? (
                      <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-primary bg-primary/10 rounded px-1.5 py-0.5">
                        worker
                      </span>
                    ) : null}
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  No matches for{" "}
                  <code className="font-mono bg-muted px-1 rounded">
                    @{mentionQuery}
                  </code>{" "}
                  — type the full username, they&apos;ll still be notified.
                </div>
              )}
            </div>
          ) : null}
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          size="sm"
          className="h-9 w-9 shrink-0 rounded-full p-0"
          title="Send message"
          aria-label="Send message"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function ChannelThread({
  channelNumber,
  channelName,
  channelUrl,
  highlightCommentId,
  onBack,
  onOpenChannels,
}: {
  channelNumber: number;
  channelName: string;
  channelUrl: string;
  highlightCommentId?: number;
  /** Exit messages entirely (back to wherever the user came from). */
  onBack?: () => void;
  /** Mobile only — open the channel switcher sheet. */
  onOpenChannels?: () => void;
}) {
  const { data, isLoading, error, refetch, isFetching } =
    useChannelThread(channelNumber);
  const { mutate: deleteChannel, isPending: deleting } = useDeleteChannel();

  const handleDelete = () => {
    if (
      !window.confirm(
        `Delete #${channelName}? This permanently removes the channel and all its messages.`,
      )
    )
      return;
    deleteChannel(channelNumber, { onSuccess: () => onBack?.() });
  };

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card/40 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {onBack ? (
            <button
              onClick={onBack}
              className="md:hidden -ml-1 p-1 text-muted-foreground hover:text-foreground"
              title="Back"
              aria-label="Back"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : null}
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
            <Hash className="w-4 h-4" />
          </div>
          {/* Desktop: plain label. Mobile: tap-to-switch channel button. */}
          <button
            type="button"
            onClick={onOpenChannels}
            disabled={!onOpenChannels}
            className="md:cursor-default md:pointer-events-none min-w-0 flex flex-col items-start text-left -my-1 py-1 rounded-md md:hover:bg-transparent hover:bg-muted/60 px-1"
          >
            <span className="inline-flex items-center gap-1 font-semibold truncate text-[15px] leading-tight">
              {channelName}
              {onOpenChannels ? (
                <ChevronDown className="md:hidden w-3.5 h-3.5 text-muted-foreground shrink-0" />
              ) : null}
            </span>
            <span className="text-[11px] text-muted-foreground leading-tight">
              {isFetching ? "syncing…" : "channel"}
            </span>
          </button>
        </div>
        <a
          href={channelUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md px-2 py-1.5 hover:bg-muted transition-colors shrink-0"
          title="Open on GitHub"
        >
          <ExternalLink className="w-4 h-4" />
          <span className="hidden sm:inline">GitHub</span>
        </a>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-destructive">
          Failed to load messages: {(error as Error).message}
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <MessageList
          comments={data?.comments ?? []}
          highlightCommentId={highlightCommentId}
        />
      )}

      <MessageComposer channelNumber={channelNumber} channelName={channelName} />
    </div>
  );
}

function CreateChannelForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const { githubUser } = useGitHubIdentity();
  const { mutate, isPending } = useCreateChannel(githubUser?.login);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || isPending) return;
    mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setName("");
          onClose();
        },
      },
    );
  };

  return (
    <div className="p-2 mx-2 my-1 rounded-lg bg-muted/50 space-y-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onClose();
        }}
        placeholder="new-channel-name"
        autoFocus
        disabled={isPending}
        className="h-8 text-sm"
      />
      <div className="flex justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onClose}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={submit}
          disabled={!name.trim() || isPending}
        >
          {isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            "Create"
          )}
        </Button>
      </div>
    </div>
  );
}

/** Channel list + "new channel" affordance, used in both the desktop
 *  sidebar and the mobile channels Sheet. */
function ChannelListPanel({
  channels,
  selected,
  onSelect,
  creating,
  setCreating,
}: {
  channels: ReadonlyArray<{ number: number; name: string }>;
  selected: number | null;
  onSelect: (n: number) => void;
  creating: boolean;
  setCreating: (next: boolean | ((prev: boolean) => boolean)) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <span className="text-[15px] font-semibold inline-flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          Channels
          {channels.length > 0 ? (
            <span className="text-xs font-normal text-muted-foreground">
              {channels.length}
            </span>
          ) : null}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setCreating((v) => !v)}
          title="New channel"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {creating ? (
        <CreateChannelForm onClose={() => setCreating(false)} />
      ) : null}

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {channels.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            No channels yet. Tap + to create one.
          </p>
        ) : (
          channels.map((c) => {
            const active = c.number === selected;
            return (
              <button
                key={c.number}
                onClick={() => onSelect(c.number)}
                className={cn(
                  "group relative w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[15px] text-left transition-colors",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {active ? (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
                ) : null}
                <Hash
                  className={cn(
                    "w-4 h-4 shrink-0",
                    active
                      ? "text-primary"
                      : "text-muted-foreground/60 group-hover:text-foreground",
                  )}
                />
                <span className="truncate">{c.name}</span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

export function MessagesView() {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useMessageChannels();

  // Deep link from a push notification / inbox entry:
  // /messages?channel=<n>&c=<commentDatabaseId>. Read once on mount.
  const deepLink = useMemo(() => {
    if (typeof window === "undefined") return null;
    const p = new URLSearchParams(window.location.search);
    const ch = Number(p.get("channel"));
    if (!Number.isInteger(ch) || ch <= 0) return null;
    const c = Number(p.get("c"));
    return {
      channel: ch,
      commentId: Number.isInteger(c) && c > 0 ? c : undefined,
    };
  }, []);

  const [selected, setSelected] = useState<number | null>(
    deepLink?.channel ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [channelsSheetOpen, setChannelsSheetOpen] = useState(false);

  /** Exit /messages — back to the previous history entry, or root if
   *  the user landed here directly (deep link / push notification). */
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  const channels = useMemo(
    () => (data?.enabled ? data.channels : []),
    [data],
  );

  // Auto-open the first channel once, on initial load only. Guarded by a
  // ref so the mobile "back to channels" action (which sets selected=null)
  // isn't immediately undone.
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (didAutoSelect.current) return;
    if (selected === null && channels.length > 0) {
      setSelected(channels[0].number);
    }
    if (selected !== null || channels.length > 0) {
      didAutoSelect.current = true;
    }
  }, [channels, selected]);

  const activeChannel = channels.find((c) => c.number === selected) ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-2 text-sm text-destructive">
        Failed to load channels: {(error as Error).message}
        <Button size="sm" variant="ghost" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (data && !data.enabled) {
    return (
      <div className="p-6">
        <DiscussionsDisabledBadge
          reason={data.reason}
          message={data.message}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background md:border md:border-border md:rounded-xl md:shadow-sm">
      {/* Desktop sidebar — always visible on md+, never on mobile. */}
      <aside className="hidden md:flex shrink-0 flex-col w-64 border-r border-border bg-card/40">
        <ChannelListPanel
          channels={channels}
          selected={selected}
          onSelect={setSelected}
          creating={creating}
          setCreating={setCreating}
        />
      </aside>

      <main className="flex flex-col flex-1 min-w-0">
        {activeChannel ? (
          <ChannelThread
            key={activeChannel.number}
            channelNumber={activeChannel.number}
            channelName={activeChannel.name}
            channelUrl={activeChannel.url}
            onBack={goBack}
            onOpenChannels={() => setChannelsSheetOpen(true)}
            highlightCommentId={
              deepLink && deepLink.channel === activeChannel.number
                ? deepLink.commentId
                : undefined
            }
          />
        ) : (
          <div className="flex flex-col h-full">
            {/* Mobile header with back + channels switcher even when no
                channel is active, so the user is never stranded. */}
            <div className="flex md:hidden items-center gap-1 border-b border-border bg-card/40 px-3 py-3">
              <button
                onClick={goBack}
                className="-ml-1 p-1 text-muted-foreground hover:text-foreground"
                title="Back"
                aria-label="Back"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-[15px] font-semibold">Messages</span>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <MessageSquare className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {channels.length === 0
                  ? "No channels yet — create one to start the conversation."
                  : "Select a channel to start messaging."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="md:hidden"
                onClick={() => setChannelsSheetOpen(true)}
              >
                Browse channels
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Mobile channel switcher — replaces the old master/detail screen. */}
      <Sheet open={channelsSheetOpen} onOpenChange={setChannelsSheetOpen}>
        <SheetContent
          side="left"
          className="w-[86vw] sm:max-w-sm !p-0 !gap-0 flex flex-col md:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Channels</SheetTitle>
            <SheetDescription>Switch channels</SheetDescription>
          </SheetHeader>
          <ChannelListPanel
            channels={channels}
            selected={selected}
            onSelect={(n) => {
              setSelected(n);
              setChannelsSheetOpen(false);
            }}
            creating={creating}
            setCreating={setCreating}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
