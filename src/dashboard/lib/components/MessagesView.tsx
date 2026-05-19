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
import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { Textarea } from "@dashboard/ui/textarea";
import { cn } from "@dashboard/lib/utils/ui";
import { formatRelativeTime } from "../utils";
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

function MessageMarkdown({ body }: { body: string }) {
  return (
    <div
      dir="auto"
      className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed break-words"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            if (!match) {
              return (
                <code
                  className="bg-muted px-1 py-0.5 rounded text-xs"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <pre className="bg-muted p-2 rounded-md overflow-x-auto">
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
                className="text-primary hover:underline break-all"
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
}: {
  comment: GoalDiscussionComment;
  highlight?: boolean;
  /** Part of a run from the same author — hide avatar/name, show hover time. */
  grouped?: boolean;
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

  return (
    <div
      ref={ref}
      id={`msg-${comment.databaseId}`}
      className={cn(
        "group flex gap-3 px-4 scroll-mt-16 transition-colors",
        grouped ? "py-0.5" : "pt-3 pb-0.5 mt-1",
        highlight
          ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
          : "hover:bg-muted/40",
      )}
    >
      {grouped ? (
        <div className="w-8 shrink-0 select-none pt-0.5 text-right">
          <span className="text-[10px] tabular-nums text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity">
            {time.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      ) : (
        <Avatar className="h-8 w-8 mt-0.5 shrink-0 ring-1 ring-border">
          {author?.avatarUrl ? (
            <AvatarImage src={author.avatarUrl} alt={author.login} />
          ) : null}
          <AvatarFallback className="text-xs bg-muted">
            {author?.login[0]?.toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
      )}
      <div className="min-w-0 flex-1">
        {!grouped ? (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground">
              {author?.login ?? "unknown"}
            </span>
            {isBot ? (
              <span className="text-[10px] font-medium uppercase tracking-wide bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">
                bot
              </span>
            ) : null}
            <a
              href={comment.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground"
              title={time.toLocaleString()}
            >
              {formatRelativeTime(comment.createdAt)}
            </a>
          </div>
        ) : null}
        <MessageMarkdown body={comment.body} />
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

  if (comments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
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
    <div ref={ref} className="flex-1 overflow-y-auto py-2">
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
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {dayLabel(c.createdAt)}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <MessageItem
              comment={c}
              grouped={grouped}
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
    <div className="border-t border-border bg-card/40 p-3">
      <div
        className={cn(
          "rounded-xl border border-border bg-background shadow-sm transition-all",
          "focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20",
          att.isDragging && "border-primary/60 ring-2 ring-primary/30",
        )}
        {...att.dropzoneProps}
      >
        <div className="flex items-center gap-0.5 px-2 pt-2">
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

        {showPreview ? (
          <div
            dir="auto"
            className="m-2 min-h-[60px] p-3 rounded-lg bg-muted/40 text-sm prose prose-sm dark:prose-invert max-w-none"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {body || "*Nothing to preview*"}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={body}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={`Message #${channelName} — use @ to mention, ⌘↵ to send`}
              rows={3}
              dir="auto"
              disabled={isPending}
              className="resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {showMentions ? (
              <div className="absolute bottom-full left-2 mb-2 z-50 w-72 max-h-48 overflow-y-auto rounded-xl border border-border bg-popover shadow-dropdown p-1">
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
        )}

        <div className="px-2 pb-2">
          <AttachmentBar api={att} disabled={isPending} />
        </div>
      </div>

      <div className="flex justify-end items-center gap-2 pt-2">
        {error ? (
          <span className="text-destructive text-xs mr-auto">
            {error.message}
          </span>
        ) : null}
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          size="sm"
          className="h-8 px-3 gap-1.5"
          title="Send message"
        >
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          <span>{isPending ? "Sending…" : "Send"}</span>
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
}: {
  channelNumber: number;
  channelName: string;
  channelUrl: string;
  highlightCommentId?: number;
  onBack?: () => void;
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
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card/40 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {onBack ? (
            <button
              onClick={onBack}
              className="md:hidden -ml-1 p-1 text-muted-foreground hover:text-foreground"
              title="Back to channels"
              aria-label="Back to channels"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : null}
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
            <Hash className="w-4 h-4" />
          </div>
          <span className="font-semibold truncate text-[15px]">
            {channelName}
          </span>
          {isFetching ? (
            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        <a
          href={channelUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md px-2 py-1 hover:bg-muted transition-colors shrink-0"
          title="Open on GitHub"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          GitHub
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

export function MessagesView() {
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
    <div className="flex h-[calc(100dvh-8rem)] border border-border rounded-xl overflow-hidden bg-background shadow-sm">
      <aside
        className={cn(
          "shrink-0 border-r border-border flex-col w-full md:w-64 bg-card/40",
          selected !== null ? "hidden md:flex" : "flex",
        )}
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
          <span className="text-sm font-semibold inline-flex items-center gap-2">
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
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
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
              No channels yet. Create one to start the conversation.
            </p>
          ) : (
            channels.map((c) => {
              const active = c.number === selected;
              return (
                <button
                  key={c.number}
                  onClick={() => setSelected(c.number)}
                  className={cn(
                    "group relative w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-left transition-colors",
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
                      "w-3.5 h-3.5 shrink-0",
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
      </aside>

      <main
        className={cn(
          "flex-1 min-w-0",
          selected !== null ? "flex flex-col" : "hidden md:flex md:flex-col",
        )}
      >
        {activeChannel ? (
          <ChannelThread
            key={activeChannel.number}
            channelNumber={activeChannel.number}
            channelName={activeChannel.name}
            channelUrl={activeChannel.url}
            onBack={() => setSelected(null)}
            highlightCommentId={
              deepLink && deepLink.channel === activeChannel.number
                ? deepLink.commentId
                : undefined
            }
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Select or create a channel to start messaging.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
