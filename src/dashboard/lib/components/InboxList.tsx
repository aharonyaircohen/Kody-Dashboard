"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern inbox-list
 * @ai-summary Inbox UI: two sections (Unread / Read) of mention entries
 *   pulled from the user's per-repo gist. Each row shows author + title +
 *   snippet + relative time; click opens the deep URL in a new tab and
 *   marks the entry read. Top toolbar exposes mark-all-read, refresh, and
 *   a one-click jump to settings if the PAT is missing the `gist` scope.
 */
import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCheck,
  ExternalLink,
  Inbox as InboxIcon,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { PageShell } from "./PageShell";
import { useAuth } from "../auth-context";
import { useInbox } from "../inbox/useInbox";
import { cn } from "../utils";
import type { InboxEntry, InboxSource } from "../inbox/types";

const SOURCE_LABEL: Record<InboxSource, string> = {
  mention: "mentioned you",
  team_mention: "mentioned your team",
  review_requested: "requested your review",
  assigned: "assigned you",
  comment: "commented",
  subscribed: "subscribed thread",
  other: "activity",
};

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

interface RowProps {
  entry: InboxEntry;
  onOpen: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}

function Row({ entry, onOpen, onToggleRead, onDelete }: RowProps) {
  const unread = entry.readAt === null;
  const author = entry.author ? `@${entry.author}` : "Someone";
  const label = SOURCE_LABEL[entry.source];
  return (
    <li
      className={cn(
        "group relative rounded-lg border px-3 py-3 transition-colors",
        unread
          ? "border-amber-500/30 bg-amber-500/[0.04] hover:bg-amber-500/[0.07]"
          : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className={cn(
            "mt-1.5 w-2 h-2 rounded-full shrink-0",
            unread ? "bg-amber-400" : "bg-white/20",
          )}
        />
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-medium truncate">
              <span className="text-white/90">{author}</span>
              <span className="text-white/50"> {label}</span>
              {entry.title && (
                <span className="text-white/70"> · {entry.title}</span>
              )}
            </div>
            <span className="text-[10px] text-white/40 shrink-0">
              {relativeTime(entry.sentAt)}
            </span>
          </div>
          {entry.snippet && (
            <p className="mt-1 text-xs text-white/60 line-clamp-2">
              {entry.snippet}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-white/40">
            <span className="truncate">{entry.repoFullName}</span>
            <span>·</span>
            <span className="truncate">{entry.threadType}</span>
          </div>
        </button>
        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onToggleRead}
            title={unread ? "Mark as read" : "Mark as unread"}
            className="p-1 rounded text-white/50 hover:text-white hover:bg-white/[0.06]"
          >
            <CheckCheck className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Remove"
            className="p-1 rounded text-white/50 hover:text-rose-300 hover:bg-rose-500/10"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

export function InboxList() {
  const { auth } = useAuth();
  const {
    unread,
    read,
    isLoading,
    error,
    refetch,
    markRead,
    markUnread,
    markAllRead,
    remove,
  } = useInbox();
  const [busyId, setBusyId] = useState<string | null>(null);

  const scopeMissing = /gist_scope_missing|gist.*scope/i.test(
    error?.message ?? "",
  );

  const subtitle = auth ? `${auth.owner}/${auth.repo}` : undefined;

  const openEntry = async (entry: InboxEntry) => {
    if (typeof window !== "undefined") {
      window.open(entry.url, "_blank", "noopener,noreferrer");
    }
    if (entry.readAt === null) {
      setBusyId(entry.id);
      try {
        await markRead(entry.id);
      } finally {
        setBusyId(null);
      }
    }
  };

  return (
    <PageShell
      title="Inbox"
      icon={InboxIcon}
      iconClassName="text-amber-300"
      subtitle={subtitle}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refetch()}
            disabled={isLoading}
            className="gap-1"
            aria-label="Refresh inbox"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void markAllRead()}
            disabled={unread.length === 0}
            className="gap-1"
          >
            <CheckCheck className="w-4 h-4" />
            Mark all read
          </Button>
        </>
      }
    >
      {scopeMissing && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 text-amber-300 shrink-0" />
            <div>
              <p className="font-medium text-amber-200">PAT missing the `gist` scope</p>
              <p className="text-xs text-amber-100/70 mt-1">
                The inbox lives in a private gist owned by you. Re-connect this
                repo with a PAT that includes the `gist` scope on the{" "}
                <Link href="/repos" className="underline">
                  Repositories
                </Link>{" "}
                page.
              </p>
            </div>
          </div>
        </div>
      )}

      {error && !scopeMissing && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3 text-xs text-rose-200">
          {error.message}
        </div>
      )}

      <Section
        title={`Unread (${unread.length})`}
        empty={
          isLoading
            ? "Loading…"
            : "Nothing unread. New @mentions land here automatically."
        }
        entries={unread}
        busyId={busyId}
        onOpen={openEntry}
        onToggleRead={(id) => void markUnread(id)}
        onDelete={(id) => void remove(id)}
        readSection={false}
      />

      {read.length > 0 && (
        <div className="mt-6">
          <Section
            title={`Read (${read.length})`}
            empty=""
            entries={read}
            busyId={busyId}
            onOpen={openEntry}
            onToggleRead={(id) => void markUnread(id)}
            onDelete={(id) => void remove(id)}
            readSection
          />
        </div>
      )}

      <p className="mt-8 text-[10px] text-white/30 flex items-center gap-1">
        <ExternalLink className="w-3 h-3" />
        Entries are stored in a private gist on your GitHub account. Switching
        repos swaps the inbox automatically.
      </p>
    </PageShell>
  );
}

interface SectionProps {
  title: string;
  empty: string;
  entries: InboxEntry[];
  busyId: string | null;
  onOpen: (entry: InboxEntry) => void;
  onToggleRead: (id: string) => void;
  onDelete: (id: string) => void;
  readSection: boolean;
}

function Section({
  title,
  empty,
  entries,
  busyId,
  onOpen,
  onToggleRead,
  onDelete,
  readSection,
}: SectionProps) {
  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-2">
        {title}
      </h2>
      {entries.length === 0 ? (
        empty ? (
          <p className="text-xs text-white/40 italic">{empty}</p>
        ) : null
      ) : (
        <ul className={cn("space-y-2", readSection && "opacity-80")}>
          {entries.map((e) => (
            <Row
              key={e.id}
              entry={e}
              onOpen={() => onOpen(e)}
              onToggleRead={() => onToggleRead(e.id)}
              onDelete={() => onDelete(e.id)}
            />
          ))}
        </ul>
      )}
      {busyId && (
        <span className="sr-only" role="status">
          Updating {busyId}…
        </span>
      )}
    </div>
  );
}
