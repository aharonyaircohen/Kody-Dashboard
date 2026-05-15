"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern push-subscription-ui
 * @ai-summary Compact "Mobile / Push notifications" row for the Notification
 *   Settings panel. Renders inline help when push isn't usable from this
 *   browser (iOS not-installed, secure-origin missing, server keys missing).
 *
 *   Visual style matches the other rows in NotificationPreferences (small
 *   icon + label + checkbox/button on the right) so it doesn't feel bolted
 *   on. A small status line under the row shows actionable hints only when
 *   they apply.
 */
import { Smartphone } from "lucide-react";
import { usePushSubscription } from "./usePushSubscription";

interface PushToggleProps {
  /** Optional user identifier persisted with the subscription. */
  userLogin?: string;
  /** Optional device label (auto-detected if omitted). */
  label?: string;
}

function defaultLabel(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone Safari";
  if (/iPad/.test(ua)) return "iPad Safari";
  if (/Android/.test(ua)) return "Android Chrome";
  if (/Mac/.test(ua)) return "Mac Safari/Chrome";
  if (/Windows/.test(ua)) return "Windows Browser";
  return undefined;
}

export function PushToggle({ userLogin, label }: PushToggleProps) {
  const { status, error, enable, disable, busy } = usePushSubscription({
    userLogin,
    label: label ?? defaultLabel(),
  });

  const renderAction = () => {
    switch (status) {
      case "loading":
        return <span className="text-[10px] text-muted-foreground">…</span>;
      case "unsupported":
        return (
          <span className="text-[10px] text-muted-foreground">
            Not supported
          </span>
        );
      case "needs-pwa":
        return (
          <span className="text-[10px] text-muted-foreground">
            Add to Home Screen
          </span>
        );
      case "not-configured":
        return (
          <span className="text-[10px] text-muted-foreground">
            Server keys missing
          </span>
        );
      case "denied":
        return <span className="text-[10px] text-destructive">Blocked</span>;
      case "off":
        return (
          <button
            type="button"
            disabled={busy}
            onClick={() => void enable()}
            className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            {busy ? "…" : "Enable"}
          </button>
        );
      case "on":
        return (
          <button
            type="button"
            disabled={busy}
            onClick={() => void disable()}
            className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            {busy ? "…" : "Disable"}
          </button>
        );
    }
  };

  const helpText = (() => {
    if (status === "needs-pwa") {
      return 'On iPhone: tap Share → "Add to Home Screen", then open Kody from the icon and enable here.';
    }
    if (status === "denied") {
      return "Notifications are blocked in your browser settings — unblock to enable.";
    }
    if (status === "not-configured") {
      return "Server admin: set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY env vars.";
    }
    if (status === "unsupported") {
      return "This browser doesn't support push notifications.";
    }
    return null;
  })();

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs">
          <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
          Mobile / push notifications
        </span>
        {renderAction()}
      </div>
      {helpText && (
        <p className="text-[10px] text-muted-foreground pl-5 leading-snug">
          {helpText}
        </p>
      )}
      {error && (
        <p className="text-[10px] text-destructive pl-5 leading-snug">
          {error}
        </p>
      )}
    </div>
  );
}
