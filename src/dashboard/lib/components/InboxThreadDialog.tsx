"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern inbox-thread-dialog
 * @ai-summary Modal that renders an inbox entry's GitHub thread (Issue or
 *   PR body + comments) inside the dashboard so the user reads it here
 *   instead of being bounced to github.com. A prominent "Open on GitHub"
 *   link stays in the header for users who do want the source. Only
 *   Issue/PullRequest are resolvable inline; other thread types never open
 *   this dialog (InboxList opens github.com directly for them).
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { useAuth, buildAuthHeaders } from "../auth-context";
import type { InboxEntry } from "../inbox/types";
import type { GitHubComment } from "../types";
import { CommentList } from "./CommentList";
import { MarkdownViewer } from "./MarkdownViewer";

interface ThreadResponse {
  thread: {
    title: string;
    body: string;
    state: string;
    htmlUrl: string;
    createdAt: string;
    comments: GitHubComment[];
  };
}

/** Parse `Issue`/`PullRequest` + number out of an inbox entry, or null. */
type ResolvableType = "Issue" | "PullRequest" | "Discussion";

export function resolvableThread(
  entry: InboxEntry,
  connectedRepo: string | undefined,
): { type: ResolvableType; number: number } | null {
  if (
    entry.threadType !== "Issue" &&
    entry.threadType !== "PullRequest" &&
    entry.threadType !== "Discussion"
  ) {
    return null;
  }
  // The inline fetch is scoped to the connected repo's GitHub context.
  // GitHub's notification payload uses canonical repo casing, which can
  // differ from how the connected repo is stored — compare case-insensitively.
  if (
    connectedRepo &&
    entry.repoFullName.toLowerCase() !== connectedRepo.toLowerCase()
  ) {
    return null;
  }

  const m = entry.url.match(/\/(?:issues|pull|discussions)\/(\d+)/);
  if (!m) return null;
  return { type: entry.threadType, number: Number(m[1]) };
}

interface InboxThreadDialogProps {
  entry: InboxEntry | null;
  onClose: () => void;
}

export function InboxThreadDialog({ entry, onClose }: InboxThreadDialogProps) {
  const { auth } = useAuth();
  const target = entry
    ? resolvableThread(entry, auth ? `${auth.owner}/${auth.repo}` : undefined)
    : null;

  const query = useQuery<ThreadResponse>({
    queryKey: [
      "inbox-thread",
      auth?.owner,
      auth?.repo,
      target?.type,
      target?.number,
    ],
    enabled: !!entry && !!target && !!auth,
    staleTime: 60_000,
    queryFn: async () => {
      const headers = buildAuthHeaders(auth);
      const res = await fetch(
        `/api/kody/inbox/thread?type=${target!.type}&number=${target!.number}`,
        { headers },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Thread fetch failed (${res.status})`);
      }
      return res.json();
    },
  });

  const thread = query.data?.thread;
  const githubUrl = thread?.htmlUrl ?? entry?.url ?? "#";

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <DialogTitle className="text-base leading-snug">
              {thread?.title || entry?.title || "Thread"}
            </DialogTitle>
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200"
            >
              Open on GitHub
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          {entry && (
            <p className="text-[11px] text-white/40">
              {entry.repoFullName} · {entry.threadType}
              {thread?.state ? ` · ${thread.state}` : ""}
            </p>
          )}
        </DialogHeader>

        <div className="overflow-y-auto flex-1 space-y-4 pr-1">
          {query.isLoading && (
            <div className="flex items-center justify-center py-12 text-white/50">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}

          {query.isError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3 text-xs text-rose-200">
              Couldn&apos;t load this thread inline. Use{" "}
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Open on GitHub
              </a>{" "}
              instead.
            </div>
          )}

          {thread && (
            <>
              {thread.body ? (
                <MarkdownViewer content={thread.body} title="Description" />
              ) : (
                <p className="text-xs text-white/40 italic">
                  No description.
                </p>
              )}

              {thread.comments.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-2">
                    Comments ({thread.comments.length})
                  </h3>
                  <CommentList comments={thread.comments} />
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
