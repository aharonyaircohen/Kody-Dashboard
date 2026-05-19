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
  Trash2,
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
import { kodyApi, type GoalDiscussionComment } from "../api";

interface Mention {
  login: string;
  avatar_url: string;
}

function MessageMarkdown({ body }: { body: string }) {
  return (
    <div
      dir="auto"
      className="prose prose-sm dark:prose-invert max-w-none text-sm break-words"
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
}: {
  comment: GoalDiscussionComment;
  highlight?: boolean;
}) {
  const author = comment.author;
  const isBot = author?.login.endsWith("[bot]") ?? false;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlight && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);

  return (
    <div
      ref={ref}
      id={`msg-${comment.databaseId}`}
      className={cn(
        "flex gap-3 px-4 py-2 hover:bg-muted/30 scroll-mt-16 transition-colors",
        highlight && "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/40",
      )}
    >
      <Avatar className="h-8 w-8 mt-0.5 shrink-0">
        {author?.avatarUrl ? (
          <AvatarImage src={author.avatarUrl} alt={author.login} />
        ) : null}
        <AvatarFallback className="text-xs">
          {author?.login[0]?.toUpperCase() || "?"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">
            {author?.login ?? "unknown"}
          </span>
          {isBot ? (
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
              BOT
            </span>
          ) : null}
          <a
            href={comment.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground"
            title={new Date(comment.createdAt).toLocaleString()}
          >
            {formatRelativeTime(comment.createdAt)}
          </a>
        </div>
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
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        No messages yet — say hello below.
      </div>
    );
  }
  return (
    <div ref={ref} className="flex-1 overflow-y-auto py-2">
      {comments.map((c) => (
        <MessageItem
          key={c.id}
          comment={c}
          highlight={
            highlightCommentId !== undefined &&
            c.databaseId === highlightCommentId
          }
        />
      ))}
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

  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionQuery, setMentionQuery] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    kodyApi.collaborators
      .list()
      .then((collabs) => {
        if (cancelled) return;
        const merged: Mention[] = [...collabs];
        if (
          githubUser?.login &&
          !merged.some((m) => m.login === githubUser.login)
        ) {
          merged.unshift({
            login: githubUser.login,
            avatar_url: githubUser.avatar_url ?? "",
          });
        }
        setMentions(merged);
      })
      .catch(() => {
        if (githubUser?.login) {
          setMentions([
            { login: githubUser.login, avatar_url: githubUser.avatar_url ?? "" },
          ]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [githubUser?.login, githubUser?.avatar_url]);

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

  return (
    <div className="border-t border-border p-3 space-y-2">
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => insertMarkdown("**", "**")}
          className="h-6 w-6 p-0"
          title="Bold"
        >
          <Bold className="w-3 h-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => insertMarkdown("*", "*")}
          className="h-6 w-6 p-0"
          title="Italic"
        >
          <Italic className="w-3 h-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => insertMarkdown("`", "`")}
          className="h-6 w-6 p-0"
          title="Code"
        >
          <Code className="w-3 h-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => insertMarkdown("[", "](url)")}
          className="h-6 w-6 p-0"
          title="Link"
        >
          <Link2 className="w-3 h-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => insertMarkdown("- ")}
          className="h-6 w-6 p-0"
          title="List"
        >
          <List className="w-3 h-3" />
        </Button>
        <div className="w-px h-3 bg-border mx-0.5" />
        <Button
          type="button"
          variant={showPreview ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setShowPreview(!showPreview)}
          className="h-6 px-1.5 text-xs"
          title={showPreview ? "Edit" : "Preview"}
        >
          <Eye className="w-3 h-3" />
        </Button>
      </div>

      <div
        className={cn(
          "relative rounded-md",
          att.isDragging && "ring-2 ring-emerald-500/60",
        )}
        {...att.dropzoneProps}
      >
        {showPreview ? (
          <div
            dir="auto"
            className="min-h-[60px] p-2 border border-border rounded-md bg-background text-xs prose prose-sm dark:prose-invert max-w-none"
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
              className="resize-none text-sm"
            />
            {showMentions ? (
              <div className="absolute bottom-full left-0 mb-1 z-50 w-72 max-h-48 overflow-y-auto border border-border rounded-md shadow-lg bg-popover">
                {filteredMentions.length > 0 ? (
                  filteredMentions.map((mention, index) => (
                    <button
                      key={mention.login}
                      type="button"
                      onClick={() => selectMention(mention)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent",
                        index === selectedMentionIndex && "bg-accent",
                      )}
                    >
                      <Avatar className="h-6 w-6">
                        {mention.avatar_url ? (
                          <AvatarImage
                            src={mention.avatar_url}
                            alt={mention.login}
                          />
                        ) : null}
                        <AvatarFallback className="text-xs">
                          {mention.login[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{mention.login}</span>
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
      </div>

      <AttachmentBar api={att} disabled={isPending} />

      <div className="flex justify-end items-center gap-2">
        {error ? (
          <span className="text-destructive text-xs mr-auto">
            {error.message}
          </span>
        ) : null}
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          size="sm"
          className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700 gap-1.5"
          title="Send message"
        >
          {isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Send className="w-3 h-3" />
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
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
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
          <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="font-semibold truncate">{channelName}</span>
          {isFetching ? (
            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        <a
          href={channelUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
          title="Open on GitHub"
        >
          <ExternalLink className="w-3 h-3" />
          GitHub
        </a>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-red-300">
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
    <div className="p-2 border-b border-border space-y-2">
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
          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
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
      <div className="flex flex-col items-center justify-center h-[70vh] gap-2 text-sm text-red-300">
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
    <div className="flex h-[calc(100dvh-8rem)] border border-border rounded-lg overflow-hidden bg-background">
      <aside
        className={cn(
          "shrink-0 border-r border-border flex-col w-full md:w-56",
          selected !== null ? "hidden md:flex" : "flex",
        )}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <span className="text-sm font-semibold inline-flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4" />
            Channels
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => setCreating((v) => !v)}
            title="New channel"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {creating ? (
          <CreateChannelForm onClose={() => setCreating(false)} />
        ) : null}

        <div className="flex-1 overflow-y-auto py-1">
          {channels.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              No channels yet. Create one to start the conversation.
            </p>
          ) : (
            channels.map((c) => (
              <button
                key={c.number}
                onClick={() => setSelected(c.number)}
                className={cn(
                  "w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-left hover:bg-muted/50 truncate",
                  c.number === selected
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                <Hash className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{c.name}</span>
              </button>
            ))
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
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select or create a channel to start messaging.
          </div>
        )}
      </main>
    </div>
  );
}
