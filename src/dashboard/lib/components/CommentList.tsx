/**
 * @fileType component
 * @domain kody
 * @pattern comment-list
 * @ai-summary Component to display comments with markdown rendering
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../utils";
import type { GitHubComment } from "../types";
import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import { cn } from "@dashboard/lib/utils/ui";
import { Button } from "@dashboard/ui/button";
import { Wrench, Loader2, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { prsApi } from "../api";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { autoDirProps, rtlAwareMarkdownClassName } from "../text-direction";
import { MarkdownPreview } from "./MarkdownPreview";

interface CommentListProps {
  comments: GitHubComment[];
  loading?: boolean;
  /** Associated PR number — enables the "Send to Kody to fix" button on pinned QA issues. */
  prNumber?: number;
  /**
   * GitHub comment id that triggered the open (parsed from the inbox
   * entry's URL anchor). When set, the list scrolls that comment into
   * view and briefly highlights it. When absent, it scrolls to the
   * last comment (end of the discussion).
   */
  targetCommentId?: number;
}

/** Strip the leading `🛑 QA:` marker so dispatch quotes the raw notes. */
function stripQAPrefix(body: string): string {
  return body.replace(/^🛑 QA:\s*/, "").trim();
}

export function CommentList({
  comments,
  loading,
  prNumber,
  targetCommentId,
}: CommentListProps) {
  // On open, focus the comment that triggered this view (or the end of
  // the discussion when there's no specific target). scrollIntoView walks
  // up to the real scrollable ancestor (the dialog body) — setting
  // scrollTop on this inner non-scrolling div would be a no-op.
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !comments || comments.length === 0) return;

    let el: HTMLElement | null =
      targetCommentId != null
        ? root.querySelector<HTMLElement>(
            `[data-comment-id="${targetCommentId}"]`,
          )
        : null;
    if (!el) {
      const all = root.querySelectorAll<HTMLElement>("[data-comment-id]");
      el = all.length ? all[all.length - 1] : null;
    }
    if (!el) return;

    el.scrollIntoView({ block: targetCommentId != null ? "center" : "end" });

    if (targetCommentId != null) {
      const target = el;
      target.classList.add("ring-2", "ring-amber-400/60");
      const t = setTimeout(
        () => target.classList.remove("ring-2", "ring-amber-400/60"),
        2200,
      );
      return () => clearTimeout(t);
    }
  }, [comments, targetCommentId]);

  if (loading) {
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

  if (!comments || comments.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No comments yet
      </div>
    );
  }

  // Pin QA-issue comments to the top so unresolved-problem documentation is
  // the first thing visible. They still appear inline in chronological order
  // below — keeping the timeline intact.
  const qaIssues = comments.filter((c) => c.body?.startsWith("🛑 QA:"));

  return (
    <div ref={containerRef} className="space-y-3">
      {qaIssues.length > 0 && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-2">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-red-300">
              Issues ({qaIssues.length})
            </span>
            <span className="text-[10px] text-red-300/60">
              Resolved on UI approval
            </span>
          </div>
          <div className="space-y-2">
            {qaIssues.map((comment) => (
              <QAIssueItem
                key={`qa-${comment.id}`}
                comment={comment}
                prNumber={prNumber}
              />
            ))}
          </div>
        </div>
      )}
      {comments.map((comment) => (
        <CommentItem key={comment.id} comment={comment} />
      ))}
    </div>
  );
}

/**
 * Pinned QA issue card. Wraps CommentItem with a "Send to Kody to fix"
 * button that posts `@kody fix` on the PR with the original QA notes
 * quoted verbatim. Distinct from the standalone Fix wrench in PreviewActions:
 *   - Wrench → free-form fixes (you type the description).
 *   - This button → quotes an existing QA report verbatim, one-click.
 *
 * The kody:needs-fix label deliberately stays — only Approve UI clears it.
 */
function QAIssueItem({
  comment,
  prNumber,
}: {
  comment: GitHubComment;
  prNumber?: number;
}) {
  const [dispatching, setDispatching] = useState(false);
  const [dispatched, setDispatched] = useState(false);
  const { githubUser } = useGitHubIdentity();

  const handleDispatch = async () => {
    if (!prNumber || dispatched) return;
    const notes = stripQAPrefix(comment.body);
    if (!notes) {
      toast.error("Empty QA notes — nothing to dispatch");
      return;
    }
    setDispatching(true);
    try {
      await prsApi.postComment(
        prNumber,
        `@kody fix\n\n${notes}`,
        githubUser?.login,
      );
      setDispatched(true);
      toast.success("Fix dispatched — Kody will work on it");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to dispatch fix",
      );
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <CommentItem comment={comment} />
      {prNumber && (
        <div className="flex justify-end px-1">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDispatch}
            disabled={dispatching || dispatched}
            className={cn(
              "h-7 gap-1.5 text-[11px] bg-transparent border-zinc-700",
              dispatched
                ? "text-emerald-400 border-emerald-900/60"
                : "text-zinc-200 hover:bg-zinc-800/60 hover:border-zinc-600",
            )}
          >
            {dispatching ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : dispatched ? (
              <CheckCircle className="w-3 h-3" />
            ) : (
              <Wrench className="w-3 h-3" />
            )}
            <span>
              {dispatched
                ? "Fix dispatched"
                : dispatching
                  ? "Sending…"
                  : "Send to Kody to fix"}
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}

// Detect comment type from body content
function detectCommentType(body: string): string {
  // QA-flagged unresolved issues — convention used by the Report Issue flow.
  if (body.startsWith("🛑 QA:")) return "qa-issue";
  if (body.includes("🚫 Hard Stop")) return "hard-stop";
  if (
    body.includes("🚦 Risk Gate") ||
    body.includes("Risk assessment required")
  )
    return "risk-gated";
  if (body.includes("🚫 Gate Rejected") || body.includes("gate rejected"))
    return "gate-rejection";
  if (body.includes("✅ Gate Approved") || body.includes("gate approved"))
    return "gate-approval";
  if (
    body.includes("❌ Failed") ||
    body.includes("pipeline failed") ||
    body.includes("Build failed")
  )
    return "failure";
  if (
    body.includes("⏰") ||
    body.includes("timed out") ||
    body.includes("timeout")
  )
    return "timeout";
  if (body.includes("🔄") && body.includes("retry")) return "retry";
  if (body.includes("exhausted") || body.includes("max retries"))
    return "exhausted";
  if (
    body.includes("error") ||
    body.includes("Error") ||
    body.includes("failed with error")
  )
    return "error";
  if (body.includes("💬") && body.includes("clarify")) return "clarify";
  if (body.includes("🔗") && body.includes("vercel")) return "preview";
  if (
    body.includes("🎉") ||
    body.includes("completed successfully") ||
    body.includes("Done!")
  )
    return "success";
  return "default";
}

// Get styling based on comment type
function getCommentStyle(type: string, isBot: boolean) {
  const base = "p-2 rounded-lg border text-sm";

  switch (type) {
    case "qa-issue":
      return cn(base, "bg-red-500/10 border-red-500/40");
    case "hard-stop":
      return cn(base, "bg-red-500/10 border-red-500/50");
    case "risk-gated":
      return cn(base, "bg-yellow-500/10 border-yellow-500/50");
    case "gate-rejection":
      return cn(base, "bg-red-500/10 border-red-500/50");
    case "gate-approval":
      return cn(base, "bg-emerald-500/10 border-emerald-500/50");
    case "failure":
      return cn(base, "bg-red-500/10 border-red-500/30");
    case "timeout":
      return cn(base, "bg-orange-500/10 border-orange-500/50");
    case "retry":
      return cn(base, "bg-blue-500/10 border-blue-500/30");
    case "exhausted":
      return cn(base, "bg-orange-500/10 border-orange-500/50");
    case "error":
      return cn(base, "bg-red-500/10 border-red-500/30");
    case "clarify":
      return cn(base, "bg-blue-500/10 border-blue-500/30");
    case "preview":
      return cn(base, "bg-emerald-500/10 border-emerald-500/30");
    case "success":
      return cn(base, "bg-emerald-500/10 border-emerald-500/30");
    default:
      return cn(
        base,
        isBot ? "bg-muted/30 border-muted" : "bg-background border-border",
      );
  }
}

function CommentItem({ comment }: { comment: GitHubComment }) {
  const isBot = comment.user.login.endsWith("[bot]");
  const commentType = detectCommentType(comment.body);
  const commentStyle = getCommentStyle(commentType, isBot);

  return (
    <div
      className={commentStyle}
      data-comment-id={comment.id}
      style={{ scrollMarginTop: 16, scrollMarginBottom: 16 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        {commentType !== "default" && (
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded font-medium uppercase shrink-0",
              commentType === "qa-issue" && "bg-red-600 text-white",
              commentType === "hard-stop" && "bg-red-600 text-white",
              commentType === "risk-gated" && "bg-yellow-600 text-white",
              commentType === "gate-rejection" && "bg-red-600 text-white",
              commentType === "gate-approval" && "bg-emerald-600 text-white",
              commentType === "failure" && "bg-red-600 text-white",
              commentType === "timeout" && "bg-orange-600 text-white",
              commentType === "retry" && "bg-blue-600 text-white",
              commentType === "exhausted" && "bg-orange-600 text-white",
              commentType === "error" && "bg-red-600 text-white",
              commentType === "clarify" && "bg-blue-600 text-white",
              commentType === "preview" && "bg-emerald-600 text-white",
              commentType === "success" && "bg-emerald-600 text-white",
            )}
          >
            {commentType}
          </span>
        )}
        <div className="flex items-center gap-2">
          <Avatar className="h-6 w-6">
            <AvatarImage
              src={comment.user.avatar_url}
              alt={comment.user.login}
            />
            <AvatarFallback className="text-xs">
              {comment.user.login[0]?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <span
            className={cn(
              "text-sm font-medium",
              isBot ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {comment.user.login}
            {isBot && (
              <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded">
                BOT
              </span>
            )}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(comment.created_at)}
        </span>
      </div>

      {/* Body - Rendered markdown */}
      <MarkdownPreview
        {...autoDirProps}
        content={comment.body}
        variant="compact"
        className={cn("text-sm text-start", rtlAwareMarkdownClassName)}
      />
    </div>
  );
}
