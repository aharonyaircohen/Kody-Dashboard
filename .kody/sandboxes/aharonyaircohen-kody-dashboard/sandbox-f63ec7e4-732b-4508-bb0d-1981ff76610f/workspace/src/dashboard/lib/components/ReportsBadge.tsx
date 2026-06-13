"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern reports-badge
 * @ai-summary Tiny unread-count badge for the Reports nav link. Mirrors
 *   `InboxBadge`: renders nothing while loading or at zero, so it doesn't
 *   pop in/out from undefined → 0. Driven by `useReportsUnread`
 *   (localStorage last-seen per report slug vs `report.updatedAt`).
 */
import { cn } from "../utils";
import { useReportsUnread } from "../hooks/useReportsUnread";

interface ReportsBadgeProps {
  className?: string;
}

export function ReportsBadge({ className }: ReportsBadgeProps) {
  const { unreadCount, isLoading } = useReportsUnread();
  if (isLoading || unreadCount <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold",
        "bg-sky-500/90 text-black",
        className,
      )}
      aria-label={`${unreadCount} unread report${unreadCount === 1 ? "" : "s"}`}
    >
      {unreadCount > 99 ? "99+" : unreadCount}
    </span>
  );
}
