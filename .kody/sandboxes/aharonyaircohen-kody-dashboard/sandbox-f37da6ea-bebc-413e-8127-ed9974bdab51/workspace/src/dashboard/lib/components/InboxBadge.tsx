"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern inbox-badge
 * @ai-summary Tiny unread-count badge for the nav. Renders nothing while
 *   loading or when zero so it doesn't pop in/out from undefined → 0.
 */
import { cn } from "../utils";
import { useInbox } from "../inbox/useInbox";

interface InboxBadgeProps {
  className?: string;
}

export function InboxBadge({ className }: InboxBadgeProps) {
  const { unreadCount, isLoading } = useInbox();
  if (isLoading || unreadCount <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold",
        "bg-amber-500/90 text-black",
        className,
      )}
      aria-label={`${unreadCount} unread inbox item${unreadCount === 1 ? "" : "s"}`}
    >
      {unreadCount > 99 ? "99+" : unreadCount}
    </span>
  );
}
