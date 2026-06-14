/**
 * @fileType hook
 * @domain kody
 * @pattern reports-unread
 * @ai-summary Per-user unread tracking for system reports. Each report
 *   under `kody-state:.kody/reports/<slug>.md` is "unread" when its
 *   `updatedAt` advances past the locally-stored `lastSeen[slug]` ISO timestamp.
 *   Storage: localStorage (per-device, per-user). Cross-tab sync via the
 *   `storage` event. Mirrors the InboxBadge unread-count contract so the
 *   sidebar badge can plug in without bespoke wiring.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReports } from "./useReports";

const STORAGE_KEY = "kody.reports.last-seen";

type LastSeenMap = Record<string, string>;

function readStorage(): LastSeenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: LastSeenMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function writeStorage(map: LastSeenMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // private mode / quota — UI still updates from in-memory state
  }
}

export function useReportsUnread() {
  const { data: reports = [], isLoading } = useReports();

  // Hydration-safe: start empty, then load on the client so SSR/CSR match.
  const [lastSeen, setLastSeen] = useState<LastSeenMap>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLastSeen(readStorage());
    setHydrated(true);

    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setLastSeen(readStorage());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const markRead = useCallback((slug: string, updatedAt: string) => {
    setLastSeen((prev) => {
      if (prev[slug] === updatedAt) return prev;
      const next = { ...prev, [slug]: updatedAt };
      writeStorage(next);
      return next;
    });
  }, []);

  const isUnread = useCallback(
    (slug: string, updatedAt: string): boolean => {
      // Until we've hydrated from storage, don't flag anything as unread —
      // avoids a misleading badge flash on first paint.
      if (!hydrated) return false;
      const seen = lastSeen[slug];
      return !seen || seen < updatedAt;
    },
    [hydrated, lastSeen],
  );

  const unreadCount = useMemo(() => {
    if (!hydrated) return 0;
    return reports.reduce(
      (n, r) => (isUnread(r.slug, r.updatedAt) ? n + 1 : n),
      0,
    );
  }, [reports, isUnread, hydrated]);

  return { unreadCount, isUnread, markRead, isLoading: isLoading || !hydrated };
}
