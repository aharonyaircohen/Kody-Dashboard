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
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Check,
  CheckCheck,
  ExternalLink,
  Inbox as InboxIcon,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@dashboard/ui/button";
import { PageShell } from "./PageShell";
import { InboxThreadDialog, resolvableThread } from "./InboxThreadDialog";
import { useAuth } from "../auth-context";
import { useInbox } from "../inbox/useInbox";
import { cn } from "../utils";
import { kodyApi } from "../api";
import {
  detectCtoRecommendation,
  type CtoAction,
} from "../cto/recommendation";
import { useCtoDecisions } from "../cto/useCtoDecisions";
import type { InboxEntry, InboxSource } from "../inbox/types";
import {
  INBOX_THREAD_PARAM,
  buildSyntheticInboxEntry,
  buildThreadShareLink,
  parseThreadParam,
  serializeThreadParam,
  type DeepLinkType,
} from "../inbox/deep-link";

type CtoVerdict = "approve" | "reject";

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
  connectedRepo: string | undefined;
  onOpen: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
  onCtoDecision: (entry: InboxEntry, verdict: CtoVerdict) => Promise<void>;
  verdictFor: (taskNumber: number, action: CtoAction) => CtoVerdict | null;
}

function Row({
  entry,
  connectedRepo,
  onOpen,
  onToggleRead,
  onDelete,
  onCtoDecision,
  verdictFor,
}: RowProps) {
  const unread = entry.readAt === null;
  const [copied, setCopied] = useState(false);

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
  const ctoVerdict = cto ? verdictFor(cto.taskNumber, cto.action) : null;
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
        <div className="mt-2.5 ml-5 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-amber-300/70">
            CTO · {cto.action === "other" ? "review" : cto.action}
          </span>
          {ctoVerdict ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
                ctoVerdict === "approve"
                  ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200"
                  : "border-rose-500/30 bg-rose-500/[0.06] text-rose-200",
              )}
              title="This recommendation was already decided"
            >
              {ctoVerdict === "approve" ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <X className="w-3.5 h-3.5" />
              )}
              {ctoVerdict === "approve" ? "Approved" : "Rejected"}
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
            </>
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
    error,
    refetch,
    markRead,
    markUnread,
    markAllRead,
    remove,
  } = useInbox();
  const { verdictFor, invalidate: invalidateCtoDecisions } = useCtoDecisions();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeEntry, setActiveEntry] = useState<InboxEntry | null>(null);
  const connectedRepo = auth ? `${auth.owner}/${auth.repo}` : undefined;

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
    if (searchParams.get(INBOX_THREAD_PARAM) === value) return;
    const next = new URLSearchParams(searchParams);
    next.set(INBOX_THREAD_PARAM, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (!deepLink || !connectedRepo || activeEntry) return;
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
        });
      } else {
        toast.success(`Rejected — #${rec.taskNumber} left as-is`);
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

      <Section
        title={`Unread (${unread.length})`}
        empty={
          isLoading
            ? "Loading…"
            : "Nothing unread. New @mentions land here automatically."
        }
        entries={unread}
        connectedRepo={connectedRepo}
        busyId={busyId}
        onOpen={openEntry}
        onToggleRead={(id) => void markUnread(id)}
        onDelete={(id) => void remove(id)}
        onCtoDecision={handleCtoDecision}
        verdictFor={verdictFor}
        readSection={false}
      />

      {read.length > 0 && (
        <div className="mt-6">
          <Section
            title={`Read (${read.length})`}
            empty=""
            entries={read}
            connectedRepo={connectedRepo}
            busyId={busyId}
            onOpen={openEntry}
            onToggleRead={(id) => void markUnread(id)}
            onDelete={(id) => void remove(id)}
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
              verdict={verdictFor(rec.taskNumber, rec.action)}
              githubUrl={activeEntry.url}
              onDecide={(v) => handleCtoDecision(activeEntry, v)}
            />
          );
        })()}
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
            verdict === "approve"
              ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200"
              : "border-rose-500/30 bg-rose-500/[0.06] text-rose-200",
          )}
          title="This recommendation was already decided"
        >
          {verdict === "approve" ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <X className="w-3.5 h-3.5" />
          )}
          {verdict === "approve" ? "Approved" : "Rejected"}
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
  onCtoDecision: (entry: InboxEntry, verdict: CtoVerdict) => Promise<void>;
  verdictFor: (taskNumber: number, action: CtoAction) => CtoVerdict | null;
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
        <ul className={cn("space-y-2", readSection && "opacity-80")}>
          {entries.map((e) => (
            <Row
              key={e.id}
              entry={e}
              connectedRepo={connectedRepo}
              onOpen={() => onOpen(e)}
              onToggleRead={() => onToggleRead(e.id)}
              onDelete={() => onDelete(e.id)}
              onCtoDecision={onCtoDecision}
              verdictFor={verdictFor}
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
