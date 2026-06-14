"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern messages-badge
 * @ai-summary Nav badge counting channels with new activity since the user last
 *   opened them. Mirrors InboxBadge — renders nothing while loading or at zero.
 */
import { cn } from "../utils";
import { useChannelsUnread } from "../hooks/useChannelsUnread";

interface MessagesBadgeProps {
  className?: string;
}

export function MessagesBadge({ className }: MessagesBadgeProps) {
  const { unreadCount, isLoading } = useChannelsUnread();
  if (isLoading || unreadCount <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold",
        "bg-amber-500/90 text-black",
        className,
      )}
      aria-label={`${unreadCount} channel${unreadCount === 1 ? "" : "s"} with new messages`}
    >
      {unreadCount > 99 ? "99+" : unreadCount}
    </span>
  );
}
