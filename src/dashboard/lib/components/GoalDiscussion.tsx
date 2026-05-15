/**
 * @fileType component
 * @domain kody
 * @pattern goal-discussion
 * @ai-summary Mature messaging surface for a goal — backed by a GitHub
 *   Discussion thread. Renders a list of native discussion comments + an
 *   editor at the bottom. When the repo has Discussions disabled (or the
 *   "Goals" category is missing), renders the {@link DiscussionsDisabledBadge}
 *   in place of the thread.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bold,
  Code,
  ExternalLink,
  Eye,
  Italic,
  Link2,
  List,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Send,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import { Button } from "@dashboard/ui/button";
import { Textarea } from "@dashboard/ui/textarea";
import { cn } from "@dashboard/lib/utils/ui";
import { formatRelativeTime } from "../utils";
import {
  useGoalDiscussion,
  usePostGoalDiscussionComment,
} from "../hooks/useGoals";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { kodyApi } from "../api";
import type { DiscussionDisabledReason, GoalDiscussionComment } from "../api";

interface Mention {
  login: string;
  avatar_url: string;
}

interface GoalDiscussionProps {
  goalId: string;
}

export function GoalDiscussion({ goalId }: GoalDiscussionProps) {
  const { data, isLoading, error, refetch, isFetching } =
    useGoalDiscussion(goalId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse p-3 rounded-lg border border-border"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="h-6 w-6 rounded-full bg-muted" />
              <div className="h-3 w-20 bg-muted rounded" />
            </div>
            <div className="h-12 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
        Failed to load discussion: {(error as Error).message}
        <Button
          size="sm"
          variant="ghost"
          className="ml-2 h-6 px-2 text-red-300"
          onClick={() => refetch()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  if (!data.enabled) {
    return (
      <DiscussionsDisabledBadge reason={data.reason} message={data.message} />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <MessageSquare className="w-3.5 h-3.5" />
          <span>
            {data.comments.length}{" "}
            {data.comments.length === 1 ? "comment" : "comments"}
          </span>
          {isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        </div>
        <a
          href={data.discussion.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          title="Open discussion on GitHub"
        >
          <ExternalLink className="w-3 h-3" />
          GitHub
        </a>
      </div>

      <DiscussionCommentList comments={data.comments} />

      <DiscussionCommentEditor goalId={goalId} />
    </div>
  );
}

function DiscussionCommentList({
  comments,
}: {
  comments: GoalDiscussionComment[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [comments]);

  if (comments.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        No comments yet — kick off the discussion below.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="space-y-3 max-h-[480px] overflow-y-auto pr-1"
    >
      {comments.map((c) => (
        <DiscussionCommentItem key={c.id} comment={c} />
      ))}
    </div>
  );
}

function DiscussionCommentItem({
  comment,
}: {
  comment: GoalDiscussionComment;
}) {
  const author = comment.author;
  const isBot = author?.login.endsWith("[bot]") ?? false;

  return (
    <div
      className={cn(
        "p-3 rounded-lg border text-sm",
        isBot ? "bg-muted/30 border-muted" : "bg-background border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Avatar className="h-6 w-6">
            {author?.avatarUrl ? (
              <AvatarImage src={author.avatarUrl} alt={author.login} />
            ) : null}
            <AvatarFallback className="text-xs">
              {author?.login[0]?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <span
            className={cn(
              "text-sm font-medium",
              isBot ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {author?.login ?? "unknown"}
            {isBot ? (
              <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded">
                BOT
              </span>
            ) : null}
          </span>
        </div>
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

      <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "");
              const isInline = !match;
              if (isInline) {
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
                  className="text-primary hover:underline"
                  {...props}
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {comment.body}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function DiscussionCommentEditor({ goalId }: { goalId: string }) {
  const [body, setBody] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { githubUser } = useGitHubIdentity();

  // @mention autofill — uses the typed kodyApi client (which forwards the
  // localStorage auth headers). Plain `fetch` falls back to the bot token,
  // which isn't a collaborator on per-user repos and gets 403 → empty list.
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
        // Always include the signed-in user so they can self-mention even
        // if the collaborators list is empty (private repos / bot-only token).
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
      .catch((err) => {
        console.warn("[GoalDiscussion] collaborators load failed", err);
        // Still allow self-mention.
        if (githubUser?.login) {
          setMentions([
            {
              login: githubUser.login,
              avatar_url: githubUser.avatar_url ?? "",
            },
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

  const {
    mutate: postComment,
    isPending,
    error,
  } = usePostGoalDiscussionComment(goalId, githubUser?.login);

  const handleSubmit = () => {
    if (!body.trim() || isPending) return;
    postComment(body.trim(), {
      onSuccess: () => {
        setBody("");
        setShowPreview(false);
      },
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setBody(value);
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const m = textBeforeCursor.match(/@(\w*)$/);
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
    const textBeforeCursor = body.slice(0, cursorPos);
    const textAfterCursor = body.slice(cursorPos);
    const newBefore = textBeforeCursor.replace(/@\w*$/, `@${mention.login} `);
    setBody(newBefore + textAfterCursor);
    setShowMentions(false);
    setMentionQuery("");
    ta?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showMentions) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedMentionIndex((i) =>
          Math.min(i + 1, filteredMentions.length - 1),
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedMentionIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        if (filteredMentions[selectedMentionIndex]) {
          e.preventDefault();
          selectMention(filteredMentions[selectedMentionIndex]);
        }
        break;
      case "Escape":
        setShowMentions(false);
        break;
    }
  };

  const insertMarkdown = (before: string, after: string = "") => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = body.slice(start, end);
    const next =
      body.slice(0, start) + before + selected + after + body.slice(end);
    setBody(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    }, 0);
  };

  if (!showEditor) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start text-muted-foreground"
        onClick={() => setShowEditor(true)}
      >
        <MessageSquarePlus className="w-4 h-4 mr-2" />
        Add comment...
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-0.5 border border-border rounded-md p-1 bg-muted/30">
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

        <div className="ml-auto" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setShowEditor(false);
            setBody("");
            setShowPreview(false);
          }}
          className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          title="Close"
        >
          ✕
        </Button>
      </div>

      <div className="relative">
        {showPreview ? (
          <div className="min-h-[60px] p-2 border border-border rounded-md bg-background text-xs prose prose-sm dark:prose-invert max-w-none">
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
              placeholder="Write a comment... use @ to mention"
              rows={3}
              disabled={isPending}
              className="resize-none text-sm"
            />

            {showMentions ? (
              // Float above the textarea — inside a modal with vertical
              // overflow, dropping below clips the list. Bottom-anchored
              // also keeps the cursor-character relationship intuitive.
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
                  <div className="px-3 py-3 text-xs text-muted-foreground space-y-1">
                    <div>
                      No matches for{" "}
                      <code className="font-mono bg-muted px-1 rounded">
                        @{mentionQuery}
                      </code>
                    </div>
                    <div className="text-[10px] opacity-80">
                      You can still type the full GitHub username — they&apos;ll
                      get a notification on post.
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex justify-between items-center gap-2">
        <p className="text-[11px] text-muted-foreground leading-snug">
          Tip: type{" "}
          <code className="px-1 py-0.5 rounded bg-muted text-foreground/80 font-mono text-[10px]">
            @
          </code>{" "}
          to mention a teammate — they&apos;ll get a GitHub notification and can
          join the thread.
        </p>
        <div className="flex items-center gap-1 shrink-0">
          {error ? (
            <span className="text-destructive text-xs mr-2">
              {error.message}
            </span>
          ) : null}
          <Button
            onClick={handleSubmit}
            disabled={isPending || !body.trim()}
            size="sm"
            variant="default"
            className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700 gap-1.5"
            title="Post comment"
          >
            {isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            <span>{isPending ? "Posting…" : "Comment"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact badge shown when the repo can't host goal discussions, with a
 * tooltip-style explainer + repo-settings link. Designed to be unobtrusive
 * — the goal panel still works without comments.
 */
export function DiscussionsDisabledBadge({
  reason,
  message,
  owner,
  repo,
}: {
  reason: DiscussionDisabledReason;
  message?: string;
  owner?: string;
  repo?: string;
}) {
  const settingsUrl =
    owner && repo
      ? `https://github.com/${owner}/${repo}/settings#features`
      : null;

  const detail = (() => {
    if (message) return message;
    switch (reason) {
      case "discussions_disabled":
        return "The dashboard tried to enable Discussions for this repo but does not have admin permission. Ask a repo admin to flip it on.";
      case "category_missing":
        return "No discussion categories exist in this repo. Recreate at least one in the Discussions tab.";
      case "provision_failed":
        return "Could not create the discussion thread. Check that you have permission to post in this repo.";
      default:
        return "Discussions are unavailable.";
    }
  })();

  return (
    <div className="inline-flex items-start gap-2 rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-muted-foreground">
      <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-70" />
      <div className="space-y-1">
        <div className="font-medium text-foreground">Discussions off</div>
        <p className="leading-snug max-w-md">{detail}</p>
        {settingsUrl ? (
          <a
            href={settingsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sky-400 hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            Repo settings
          </a>
        ) : null}
      </div>
    </div>
  );
}
