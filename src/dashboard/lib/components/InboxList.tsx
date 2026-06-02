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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ExternalLink,
  Inbox as InboxIcon,
  Link2,
  Loader2,
  MinusCircle,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { PageShell } from "./PageShell";
import { OperatorsWarningBanner } from "./OperatorsWarningBanner";
import { InboxThreadDialog, resolvableThread } from "./InboxThreadDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAuth } from "../auth-context";
import { useInbox } from "../inbox/useInbox";
import { cn } from "../utils";
import { kodyApi } from "../api";
import {
  ctoCleanSnippet,
  detectCtoRecommendation,
  type CtoAction,
} from "../cto/recommendation";
import { useCtoDecisions } from "../cto/useCtoDecisions";
import { useNotificationStore } from "../notifications/useNotificationStore";
import { NOTIFICATION_META } from "../notifications/types";
import { syncMutedTypes } from "../notifications/sync-prefs";
import type { ServerNotificationType } from "../notifications/prefs-store";
import type { InboxEntry, InboxSource } from "../inbox/types";
import {
  INBOX_THREAD_PARAM,
  buildSyntheticInboxEntry,
  buildThreadShareLink,
  parseThreadParam,
  serializeThreadParam,
  type DeepLinkType,
} from "../inbox/deep-link";

type CtoVerdict = "approve" | "reject" | "dismiss";

/**
 * Visual style + label for a settled CTO verdict badge. `dismiss` is the
 * neutral "drain the queue" verdict — distinct grey palette so the
 * operator can tell at a glance it didn't approve or reject.
 */
const VERDICT_LABEL: Record<CtoVerdict, string> = {
  approve: "Approved",
  reject: "Rejected",
  dismiss: "Dismissed",
};
const VERDICT_CLASS: Record<CtoVerdict, string> = {
  approve: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200",
  reject: "border-rose-500/30 bg-rose-500/[0.06] text-rose-200",
  dismiss: "border-white/15 bg-white/[0.05] text-white/70",
};

/** Case-insensitive substring match across an entry's searchable fields. */
function matchesQuery(entry: InboxEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [
    entry.title,
    entry.snippet,
    entry.author,
    entry.repoFullName,
    entry.threadType,
    entry.source,
  ].some((field) => field?.toLowerCase().includes(needle));
}

const SOURCE_LABEL: Record<InboxSource, string> = {
  mention: "mentioned you",
  team_mention: "mentioned your team",
  review_requested: "requested your review",
  assigned: "assigned you",
  comment: "commented",
  subscribed: "subscribed thread",
  other: "activity",
};

/** Short noun labels for the source filter chips (vs SOURCE_LABEL's verbs). */
const SOURCE_CHIP: Record<InboxSource, string> = {
  mention: "Mentions",
  team_mention: "Team mentions",
  review_requested: "Review requests",
  assigned: "Assigned",
  comment: "Comments",
  subscribed: "Subscribed",
  other: "Other",
};

/** Human labels for the GitHub thread types we surface in the inbox. */
const TYPE_LABEL: Record<string, string> = {
  Issue: "Issues",
  PullRequest: "PRs",
  Discussion: "Discussions",
  Commit: "Commits",
  Release: "Releases",
};
/** Singular labels for the per-row subline (vs TYPE_LABEL's plurals). */
const TYPE_SINGULAR: Record<string, string> = {
  Issue: "Issue",
  PullRequest: "PR",
  Discussion: "Discussion",
  Commit: "Commit",
  Release: "Release",
};
/** Stable display order for the type chips; unknown types fall to the end. */
const TYPE_ORDER = ["Issue", "PullRequest", "Discussion", "Commit", "Release"];

/** Coarse "when" bucket for the date headers, computed from local midnight. */
function dateBucket(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Older";
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = 86_400_000;
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - day) return "Yesterday";
  if (t >= startOfToday - 6 * day) return "Earlier this week";
  return "Older";
}
const BUCKET_ORDER = ["Today", "Yesterday", "Earlier this week", "Older"];

/**
 * Split a (newest-first) entry list into date buckets, preserving order within
 * each bucket and dropping empty ones.
 */
function groupByDate(
  entries: InboxEntry[],
): { label: string; entries: InboxEntry[] }[] {
  const map = new Map<string, InboxEntry[]>();
  for (const e of entries) {
    const b = dateBucket(e.sentAt);
    const arr = map.get(b);
    if (arr) arr.push(e);
    else map.set(b, [e]);
  }
  return BUCKET_ORDER.filter((b) => map.has(b)).map((label) => ({
    label,
    entries: map.get(label)!,
  }));
}

type SourceFilter = InboxSource | "all";

/**
 * Combined predicate for the inbox list: search query AND each active filter
 * must pass. `ctoOnly` keeps only CTO recommendation entries (detected the
 * same way the row renders them, so legacy recs without `ctoAction` count).
 */
function matchesFilters(
  entry: InboxEntry,
  q: string,
  source: SourceFilter,
  type: string,
  ctoOnly: boolean,
): boolean {
  if (!matchesQuery(entry, q)) return false;
  if (source !== "all" && entry.source !== source) return false;
  if (type !== "all" && entry.threadType !== type) return false;
  if (ctoOnly && !detectCtoRecommendation(entry)) return false;
  return true;
}

/**
 * Notification category this entry can be muted under. New entries carry it
 * stamped at write time; for older entries (written before the field existed)
 * we infer it so the row's "Mute this type" still works:
 *   - a comment/review deep-link (url has a `#…comment`/`#…review` anchor) is
 *     the dominant inbox case → `chat-response`
 *   - a bare thread link maps by thread type (issue opened → `task-assigned`,
 *     PR opened → `pr-ready`, discussion → `chat-response`)
 * Returns null when nothing sensible maps (no mute button shown).
 */
function inboxCategory(entry: InboxEntry): ServerNotificationType | null {
  if (entry.category) return entry.category;
  const url = entry.url ?? "";
  if (/#(issuecomment|discussioncomment|pullrequestreview|discussion_r)/i.test(url))
    return "chat-response";
  switch (entry.threadType) {
    case "Issue":
      return "task-assigned";
    case "PullRequest":
      return "pr-ready";
    case "Discussion":
      return "chat-response";
    default:
      return null;
  }
}

/** Pill-style toggle used across the inbox filter bar. */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition",
        active
          ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
          : "border-white/10 bg-white/[0.02] text-white/50 hover:border-white/20 hover:text-white/80",
      )}
    >
      {children}
    </button>
  );
}

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
  connectedRepo: string | undefined;
  onOpen: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
  /** Is this notification category currently muted? */
  isMuted: (category: ServerNotificationType) => boolean;
  /** Toggle the mute state of a notification category. */
  onToggleMute: (category: ServerNotificationType) => void;
  onCtoDecision: (entry: InboxEntry, verdict: CtoVerdict) => Promise<void>;
  verdictFor: (
    staff: string,
    taskNumber: number,
    action: CtoAction,
    sinceIso?: string,
  ) => CtoVerdict | null;
}

function Row({
  entry,
  connectedRepo,
  onOpen,
  onToggleRead,
  onDelete,
  isMuted,
  onToggleMute,
  onCtoDecision,
  verdictFor,
}: RowProps) {
  const unread = entry.readAt === null;
  const [copied, setCopied] = useState(false);
  const category = inboxCategory(entry);
  const muted = category ? isMuted(category) : false;
  const categoryLabel = category ? NOTIFICATION_META[category].label : "";

  // Shareable link for this row: the in-dashboard deep link when the thread
  // can render inline (Issue/PR/Discussion in the connected repo), else the
  // GitHub URL — same predicate the inline dialog uses, so the share link
  // always matches what clicking the row does.
  const shareTarget = resolvableThread(entry, connectedRepo);
  const copyLink = async () => {
    if (typeof window === "undefined") return;
    const link = shareTarget
      ? buildThreadShareLink(
          window.location.origin,
          shareTarget.type,
          shareTarget.number,
        )
      : entry.url;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link", link);
    }
  };
  const author = entry.author ? `@${entry.author}` : "Someone";
  const label = SOURCE_LABEL[entry.source];
  const cto = detectCtoRecommendation(entry);
  // Gate the verdict by entry.sentAt: a decision recorded BEFORE this rec
  // landed belongs to an earlier rec for the same (task, action) pair, not
  // this fresh one. Without the gate every re-post of a sync/fix-ci rec
  // shows pre-stamped Dismissed once any past rec for that PR was dismissed.
  const ctoVerdict = cto
    ? verdictFor(cto.staff, cto.taskNumber, cto.action, entry.sentAt)
    : null;
  const [ctoBusy, setCtoBusy] = useState<CtoVerdict | null>(null);

  const decide = async (verdict: CtoVerdict) => {
    setCtoBusy(verdict);
    try {
      await onCtoDecision(entry, verdict);
    } finally {
      setCtoBusy(null);
    }
  };
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
          {/* Title leads so the list scans as a column of subjects; who/what
              and the thread type drop to a muted subline below. */}
          <div className="flex items-baseline justify-between gap-2">
            <h3
              className={cn(
                "min-w-0 truncate text-[15px]",
                unread
                  ? "font-semibold text-white/90"
                  : "font-medium text-white/70",
              )}
            >
              {entry.title || `${author} ${label}`}
            </h3>
            <span className="text-[10px] text-white/40 shrink-0">
              {relativeTime(entry.sentAt)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/45 min-w-0">
            <span className="text-white/60 shrink-0">{author}</span>
            <span className="truncate">{label}</span>
            <span aria-hidden className="shrink-0">
              ·
            </span>
            <span className="shrink-0">
              {TYPE_SINGULAR[entry.threadType] ?? entry.threadType}
              {shareTarget ? ` #${shareTarget.number}` : ""}
            </span>
          </div>
          {(() => {
            // CTO recs duplicate the action/task chip in their snippet —
            // strip the boilerplate so only the reason shows. Falls back
            // to the raw cleaned snippet if no marker is present.
            const preview = cto
              ? ctoCleanSnippet(entry.snippet)
              : entry.snippet;
            return preview ? (
              <p className="mt-1 text-sm text-white/55 line-clamp-2">
                {preview}
              </p>
            ) : null;
          })()}
        </button>
        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={copyLink}
            title={
              shareTarget
                ? "Copy a shareable dashboard link to this thread"
                : "Copy the GitHub link to this thread"
            }
            className="p-1 rounded text-white/50 hover:text-white hover:bg-white/[0.06]"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-300" />
            ) : (
              <Link2 className="w-3.5 h-3.5" />
            )}
          </button>
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open on GitHub"
            className="p-1 rounded text-white/50 hover:text-white hover:bg-white/[0.06]"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            type="button"
            onClick={onToggleRead}
            title={unread ? "Mark as read" : "Mark as unread"}
            className="p-1 rounded text-white/50 hover:text-white hover:bg-white/[0.06]"
          >
            <CheckCheck className="w-3.5 h-3.5" />
          </button>
          {category && (
            <button
              type="button"
              onClick={() => onToggleMute(category)}
              title={
                muted
                  ? `Unmute “${categoryLabel}” notifications`
                  : `Mute “${categoryLabel}” notifications — stop these from landing in your inbox`
              }
              className={cn(
                "p-1 rounded hover:bg-white/[0.06]",
                muted
                  ? "text-amber-300 hover:text-amber-200"
                  : "text-white/50 hover:text-white",
              )}
            >
              {muted ? (
                <Bell className="w-3.5 h-3.5" />
              ) : (
                <BellOff className="w-3.5 h-3.5" />
              )}
            </button>
          )}
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
      {cto && (
        <div className="mt-2.5 ml-5 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-amber-300/70">
              CTO · {cto.action === "other" ? "review" : cto.action}
            </span>
            <Link
              href={`/${cto.taskNumber}`}
              title="Open this task in the dashboard"
              className="text-[11px] font-medium text-sky-300/80 hover:text-sky-200 hover:underline"
            >
              Task #{cto.taskNumber}
            </Link>
            {ctoVerdict ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
                  VERDICT_CLASS[ctoVerdict],
                )}
                title="This recommendation was already decided"
              >
                {ctoVerdict === "approve" ? (
                  <Check className="w-3.5 h-3.5" />
                ) : ctoVerdict === "reject" ? (
                  <X className="w-3.5 h-3.5" />
                ) : (
                  <MinusCircle className="w-3.5 h-3.5" />
                )}
                {VERDICT_LABEL[ctoVerdict]}
              </span>
            ) : (
              <>
                {cto.dispatchable ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={ctoBusy !== null}
                    onClick={() => void decide("approve")}
                    className="h-7 gap-1 border border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200 hover:bg-emerald-500/15"
                  >
                    {ctoBusy === "approve" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    Approve
                  </Button>
                ) : (
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`'${cto.action}' has no dashboard action — the CTO is advising; act on it in GitHub`}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-white/[0.04] px-2 text-[11px] font-medium text-white/70 hover:bg-white/[0.08]"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Review on GitHub
                  </a>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ctoBusy !== null}
                  onClick={() => void decide("reject")}
                  className="h-7 gap-1 border border-rose-500/30 bg-rose-500/[0.06] text-rose-200 hover:bg-rose-500/15"
                >
                  {ctoBusy === "reject" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <X className="w-3.5 h-3.5" />
                  )}
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ctoBusy !== null}
                  onClick={() => void decide("dismiss")}
                  title="Drain this from the inbox without approving or rejecting (no effect on graduation)"
                  className="h-7 gap-1 border border-white/15 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
                >
                  {ctoBusy === "dismiss" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <MinusCircle className="w-3.5 h-3.5" />
                  )}
                  Dismiss
                </Button>
              </>
            )}
          </div>
          {cto.command && (
            <code
              title="The exact comment Approve will post on this task"
              className="w-fit max-w-full truncate rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-white/70"
            >
              {cto.command}
            </code>
          )}
        </div>
      )}
    </li>
  );
}

export function InboxList() {
  const { auth } = useAuth();
  const {
    unread,
    read,
    isLoading,
    isFetching,
    error,
    refetch,
    markRead,
    markUnread,
    markAllRead,
    clearAll,
    remove,
  } = useInbox();
  const { verdictFor, invalidate: invalidateCtoDecisions } = useCtoDecisions();
  const { prefs: notifPrefs, updatePrefs: updateNotifPrefs } =
    useNotificationStore();
  // Latest muted list, kept in a ref so the toast "Undo" callback (created at
  // mute time) always reads the current state instead of a stale closure.
  const mutedRef = useRef(notifPrefs.disabledTypes);
  useEffect(() => {
    mutedRef.current = notifPrefs.disabledTypes;
  }, [notifPrefs.disabledTypes]);

  const setCategoryMuted = (
    category: ServerNotificationType,
    shouldMute: boolean,
  ) => {
    const current = mutedRef.current;
    const has = current.includes(category);
    if (has === shouldMute) return; // already in the desired state
    const next = shouldMute
      ? [...current, category]
      : current.filter((t) => t !== category);
    mutedRef.current = next;
    updateNotifPrefs({ disabledTypes: next }); // local cache + UI
    syncMutedTypes(next); // server prefs → webhook spine drops future entries
    const label = NOTIFICATION_META[category].label;
    if (shouldMute) {
      toast.success(`Muted “${label}” notifications`, {
        description:
          "These won't land in your inbox. Manage anytime in Notification Settings.",
        action: {
          label: "Undo",
          onClick: () => setCategoryMuted(category, false),
        },
      });
    } else {
      toast(`Unmuted “${label}” notifications`);
    }
  };
  const toggleCategoryMute = (category: ServerNotificationType) =>
    setCategoryMuted(category, !mutedRef.current.includes(category));

  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeEntry, setActiveEntry] = useState<InboxEntry | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [ctoOnly, setCtoOnly] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const totalCount = unread.length + read.length;

  const handleClearAll = async () => {
    try {
      await clearAll();
      toast.success("Inbox cleared");
    } catch (err) {
      toast.error("Clear inbox failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };
  const connectedRepo = auth ? `${auth.owner}/${auth.repo}` : undefined;

  const trimmedQuery = query.trim();
  const filtersActive = sourceFilter !== "all" || typeFilter !== "all" || ctoOnly;
  const filteredUnread = useMemo(
    () =>
      unread.filter((e) =>
        matchesFilters(e, trimmedQuery, sourceFilter, typeFilter, ctoOnly),
      ),
    [unread, trimmedQuery, sourceFilter, typeFilter, ctoOnly],
  );
  const filteredRead = useMemo(
    () =>
      read.filter((e) =>
        matchesFilters(e, trimmedQuery, sourceFilter, typeFilter, ctoOnly),
      ),
    [read, trimmedQuery, sourceFilter, typeFilter, ctoOnly],
  );

  // Build the chip options from what's actually in the inbox so we never show
  // a filter that would match nothing. Derived from the unfiltered union so
  // chips stay stable while a filter is active.
  const allEntries = useMemo(() => [...unread, ...read], [unread, read]);
  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of allEntries) if (e.threadType) set.add(e.threadType);
    return [...set].sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a);
      const ib = TYPE_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [allEntries]);
  const availableSources = useMemo(() => {
    const set = new Set<InboxSource>();
    for (const e of allEntries) set.add(e.source);
    return [...set];
  }, [allEntries]);
  const hasCto = useMemo(
    () => allEntries.some((e) => detectCtoRecommendation(e)),
    [allEntries],
  );
  const showFilterBar =
    availableTypes.length > 1 || availableSources.length > 1 || hasCto;

  const clearFilters = () => {
    setSourceFilter("all");
    setTypeFilter("all");
    setCtoOnly(false);
  };

  // Shareable deep link: `/inbox?thread=<Type>:<number>` opens the thread
  // panel for that issue/PR/discussion in the *viewer's* connected repo.
  // The link targets the thread, not a gist entry (the inbox is private
  // per-user), so a synthetic entry is enough to drive the dialog.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const deepLink = useMemo(
    () => parseThreadParam(searchParams.get(INBOX_THREAD_PARAM)),
    [searchParams],
  );
  // The deep-link value we've already acted on. Without this, closing the
  // dialog (`setActiveEntry(null)`) re-runs the auto-open effect before
  // `useSearchParams()` reflects the cleared param, so `deepLink` is still
  // set and the dialog jumps back open. Tracking the consumed value makes
  // auto-open fire only for a genuinely new link, never a re-close.
  const consumedDeepLinkRef = useRef<string | null>(null);
  const clearDeepLink = () => {
    if (!searchParams.has(INBOX_THREAD_PARAM)) return;
    const next = new URLSearchParams(searchParams);
    next.delete(INBOX_THREAD_PARAM);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  // Reflect the opened thread in the URL so the address bar is the
  // shareable link and Back/refresh restore the open item.
  const syncDeepLink = (type: DeepLinkType, number: number) => {
    const value = serializeThreadParam(type, number);
    // Manually opened — mark consumed so the effect's param lag can't
    // reopen this same thread after the user closes it.
    consumedDeepLinkRef.current = value;
    if (searchParams.get(INBOX_THREAD_PARAM) === value) return;
    const next = new URLSearchParams(searchParams);
    next.set(INBOX_THREAD_PARAM, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (!deepLink || !connectedRepo || activeEntry) return;
    const key = serializeThreadParam(deepLink.type, deepLink.number);
    if (consumedDeepLinkRef.current === key) return;
    consumedDeepLinkRef.current = key;
    setActiveEntry(
      buildSyntheticInboxEntry(connectedRepo, deepLink.type, deepLink.number),
    );
  }, [deepLink, connectedRepo, activeEntry]);

  const scopeMissing = /gist_scope_missing|gist.*scope/i.test(
    error?.message ?? "",
  );

  const subtitle = auth ? `${auth.owner}/${auth.repo}` : undefined;

  // One-tap verdict on a CTO recommendation. Approve runs the action;
  // both verdicts are tallied server-side (the trust ledger). On success
  // we mark the entry read so the inbox reflects the decision immediately.
  const handleCtoDecision = async (
    entry: InboxEntry,
    verdict: CtoVerdict,
  ): Promise<void> => {
    const rec = detectCtoRecommendation(entry);
    if (!rec) return;
    try {
      const res = await kodyApi.cto.decide({
        staff: rec.staff,
        duty: rec.duty,
        taskNumber: rec.taskNumber,
        action: rec.action,
        ...(rec.command ? { command: rec.command } : {}),
        decision: verdict,
        ...(auth?.user?.login ? { actorLogin: auth.user.login } : {}),
      });
      if (verdict === "approve") {
        toast.success(
          res.executed
            ? `Approved — ${rec.action} dispatched on #${rec.taskNumber}`
            : `Recorded — ${rec.action} on #${rec.taskNumber} (no dashboard action; act on GitHub)`,
          {
            description: res.stats
              ? `${res.stats.consecutiveApprovals} in a row · ${res.stats.approvals}✓ / ${res.stats.rejections}✗`
              : undefined,
          },
        );
      } else if (verdict === "reject") {
        toast.success(`Rejected — #${rec.taskNumber} left as-is`);
      } else {
        toast.success(`Dismissed — #${rec.taskNumber} drained from inbox`, {
          description: "No effect on graduation",
        });
      }
      if (entry.readAt === null) await markRead(entry.id);
      // Flip the row to its verdict badge immediately (and on every other
      // open tab/device on next poll) — the ledger now has this decision.
      await Promise.all([refetch(), invalidateCtoDecisions()]);
    } catch (err) {
      toast.error("CTO decision failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const openEntry = async (entry: InboxEntry) => {
    // Issues/PRs in the connected repo render inline; everything else
    // (discussions, commits, cross-repo) still opens github.com.
    const target = resolvableThread(entry, connectedRepo);
    if (target) {
      setActiveEntry(entry);
      syncDeepLink(target.type, target.number);
    } else if (typeof window !== "undefined") {
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
            disabled={isFetching}
            className="gap-1"
            aria-label="Refresh inbox"
          >
            {isFetching ? (
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmClear(true)}
            disabled={totalCount === 0}
            className="gap-1 text-rose-300 hover:text-rose-200"
          >
            <Trash2 className="w-4 h-4" />
            Clear inbox
          </Button>
        </>
      }
    >
      <OperatorsWarningBanner />

      {scopeMissing && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 text-amber-300 shrink-0" />
            <div>
              <p className="font-medium text-amber-200">
                PAT missing the `gist` scope
              </p>
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

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search inbox — title, author, repo, type…"
          className="pl-9"
          aria-label="Search inbox"
        />
      </div>

      {showFilterBar && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {availableTypes.length > 1 && (
            <>
              <span className="mr-0.5 text-[10px] uppercase tracking-wide text-white/30">
                Type
              </span>
              <FilterChip
                active={typeFilter === "all"}
                onClick={() => setTypeFilter("all")}
              >
                All
              </FilterChip>
              {availableTypes.map((t) => (
                <FilterChip
                  key={t}
                  active={typeFilter === t}
                  onClick={() => setTypeFilter(typeFilter === t ? "all" : t)}
                >
                  {TYPE_LABEL[t] ?? t}
                </FilterChip>
              ))}
            </>
          )}

          {availableSources.length > 1 && (
            <>
              <span className="ml-1 mr-0.5 text-[10px] uppercase tracking-wide text-white/30">
                Source
              </span>
              <FilterChip
                active={sourceFilter === "all"}
                onClick={() => setSourceFilter("all")}
              >
                All
              </FilterChip>
              {availableSources.map((s) => (
                <FilterChip
                  key={s}
                  active={sourceFilter === s}
                  onClick={() =>
                    setSourceFilter(sourceFilter === s ? "all" : s)
                  }
                >
                  {SOURCE_CHIP[s]}
                </FilterChip>
              ))}
            </>
          )}

          {hasCto && (
            <FilterChip active={ctoOnly} onClick={() => setCtoOnly((v) => !v)}>
              Recommendations
            </FilterChip>
          )}

          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-1 inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/70"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      )}

      <Section
        title={`Unread (${filteredUnread.length})`}
        empty={
          isLoading
            ? "Loading…"
            : trimmedQuery || filtersActive
              ? "No unread matches your filters."
              : "Nothing unread. New @mentions land here automatically."
        }
        entries={filteredUnread}
        connectedRepo={connectedRepo}
        busyId={busyId}
        onOpen={openEntry}
        onToggleRead={(id) => void markRead(id)}
        onDelete={(id) => void remove(id)}
        isMuted={(c) => notifPrefs.disabledTypes.includes(c)}
        onToggleMute={toggleCategoryMute}
        onCtoDecision={handleCtoDecision}
        verdictFor={verdictFor}
        readSection={false}
      />

      {filteredRead.length > 0 && (
        <div className="mt-6">
          <Section
            title={`Read (${filteredRead.length})`}
            empty=""
            entries={filteredRead}
            connectedRepo={connectedRepo}
            busyId={busyId}
            onOpen={openEntry}
            onToggleRead={(id) => void markUnread(id)}
            onDelete={(id) => void remove(id)}
            isMuted={(c) => notifPrefs.disabledTypes.includes(c)}
            onToggleMute={toggleCategoryMute}
            onCtoDecision={handleCtoDecision}
            verdictFor={verdictFor}
            readSection
          />
        </div>
      )}

      <p className="mt-8 text-[10px] text-white/30 flex items-center gap-1">
        <ExternalLink className="w-3 h-3" />
        Entries are stored in a private gist on your GitHub account. Switching
        repos swaps the inbox automatically.
      </p>

      <InboxThreadDialog
        entry={activeEntry}
        onClose={() => {
          setActiveEntry(null);
          clearDeepLink();
        }}
        footer={(() => {
          if (!activeEntry) return undefined;
          const rec = detectCtoRecommendation(activeEntry);
          if (!rec) return undefined;
          return (
            <CtoDialogActions
              action={rec.action}
              dispatchable={rec.dispatchable}
              verdict={verdictFor(
                rec.staff,
                rec.taskNumber,
                rec.action,
                activeEntry.sentAt,
              )}
              githubUrl={activeEntry.url}
              onDecide={(v) => handleCtoDecision(activeEntry, v)}
            />
          );
        })()}
      />
      <ConfirmDialog
        open={confirmClear}
        title="Clear entire inbox?"
        description={`This permanently removes all ${totalCount} ${
          totalCount === 1 ? "entry" : "entries"
        } (read and unread). This can't be undone.`}
        confirmLabel="Clear inbox"
        variant="destructive"
        onConfirm={() => void handleClearAll()}
        onClose={() => setConfirmClear(false)}
      />
    </PageShell>
  );
}

/**
 * CTO Approve/Reject controls rendered into the thread dialog footer when
 * the opened entry is a recommendation. Mirrors the in-row CTO buttons —
 * same verdicts, same trust ledger — but lives at the bottom of the open
 * item so the operator can decide after reading the full thread.
 */
function CtoDialogActions({
  action,
  dispatchable,
  verdict,
  githubUrl,
  onDecide,
}: {
  action: string;
  dispatchable: boolean;
  verdict: CtoVerdict | null;
  githubUrl: string;
  onDecide: (verdict: CtoVerdict) => Promise<void>;
}) {
  const [busy, setBusy] = useState<CtoVerdict | null>(null);
  const decide = async (v: CtoVerdict) => {
    setBusy(v);
    try {
      await onDecide(v);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <span className="mr-auto text-[10px] uppercase tracking-wider text-amber-300/70">
        CTO · {action === "other" ? "review" : action}
      </span>
      {verdict ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
            VERDICT_CLASS[verdict],
          )}
          title="This recommendation was already decided"
        >
          {verdict === "approve" ? (
            <Check className="w-3.5 h-3.5" />
          ) : verdict === "reject" ? (
            <X className="w-3.5 h-3.5" />
          ) : (
            <MinusCircle className="w-3.5 h-3.5" />
          )}
          {VERDICT_LABEL[verdict]}
        </span>
      ) : (
        <>
          {dispatchable ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void decide("approve")}
              className="h-7 gap-1 border border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200 hover:bg-emerald-500/15"
            >
              {busy === "approve" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Approve
            </Button>
          ) : (
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`'${action}' has no dashboard action — the CTO is advising; act on it in GitHub`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-white/[0.04] px-2 text-[11px] font-medium text-white/70 hover:bg-white/[0.08]"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Review on GitHub
            </a>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void decide("reject")}
            className="h-7 gap-1 border border-rose-500/30 bg-rose-500/[0.06] text-rose-200 hover:bg-rose-500/15"
          >
            {busy === "reject" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <X className="w-3.5 h-3.5" />
            )}
            Reject
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void decide("dismiss")}
            title="Drain this from the inbox without approving or rejecting (no effect on graduation)"
            className="h-7 gap-1 border border-white/15 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
          >
            {busy === "dismiss" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <MinusCircle className="w-3.5 h-3.5" />
            )}
            Dismiss
          </Button>
        </>
      )}
    </>
  );
}

interface SectionProps {
  title: string;
  empty: string;
  entries: InboxEntry[];
  connectedRepo: string | undefined;
  busyId: string | null;
  onOpen: (entry: InboxEntry) => void;
  onToggleRead: (id: string) => void;
  onDelete: (id: string) => void;
  isMuted: (category: ServerNotificationType) => boolean;
  onToggleMute: (category: ServerNotificationType) => void;
  onCtoDecision: (entry: InboxEntry, verdict: CtoVerdict) => Promise<void>;
  verdictFor: (
    staff: string,
    taskNumber: number,
    action: CtoAction,
    sinceIso?: string,
  ) => CtoVerdict | null;
  readSection: boolean;
}

function Section({
  title,
  empty,
  entries,
  connectedRepo,
  busyId,
  onOpen,
  onToggleRead,
  onDelete,
  isMuted,
  onToggleMute,
  onCtoDecision,
  verdictFor,
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
        <div className={cn("space-y-4", readSection && "opacity-80")}>
          {groupByDate(entries).map((group) => (
            <div key={group.label}>
              <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-white/30">
                {group.label}
              </h3>
              <ul className="space-y-2">
                {group.entries.map((e) => (
                  <Row
                    key={e.id}
                    entry={e}
                    connectedRepo={connectedRepo}
                    onOpen={() => onOpen(e)}
                    onToggleRead={() => onToggleRead(e.id)}
                    onDelete={() => onDelete(e.id)}
                    isMuted={isMuted}
                    onToggleMute={onToggleMute}
                    onCtoDecision={onCtoDecision}
                    verdictFor={verdictFor}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {busyId && (
        <span className="sr-only" role="status">
          Updating {busyId}…
        </span>
      )}
    </div>
  );
}
