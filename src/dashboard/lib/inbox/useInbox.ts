"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern inbox-client
 * @ai-summary TanStack Query bindings over /api/kody/inbox. Exposes the
 *   current entries, derived unread count, and mutations for mark-read /
 *   mark-all / delete / append.
 *
 *   The query key is scoped to `(owner, repo)` so switching repos in the
 *   dashboard naturally swaps the inbox (each repo gets its own gist).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { buildAuthHeaders, useAuth } from "../auth-context";
import type { InboxEntry } from "./types";

export const inboxQueryKey = (owner?: string, repo?: string) =>
  ["inbox", owner ?? "", repo ?? ""] as const;

interface InboxResponse {
  gistId?: string | null;
  entries: InboxEntry[];
}

async function listInbox(
  headers: Record<string, string>,
): Promise<InboxEntry[]> {
  const res = await fetch("/api/kody/inbox", { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Inbox fetch failed (${res.status})`);
  }
  const data = (await res.json()) as InboxResponse;
  return Array.isArray(data.entries) ? data.entries : [];
}

async function patchEntry(
  headers: Record<string, string>,
  id: string,
  readAt: string | null,
): Promise<InboxEntry[]> {
  const res = await fetch(`/api/kody/inbox/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ readAt }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "patch failed"));
  const data = (await res.json()) as InboxResponse;
  return data.entries ?? [];
}

async function deleteEntryReq(
  headers: Record<string, string>,
  id: string,
): Promise<InboxEntry[]> {
  const res = await fetch(`/api/kody/inbox/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "delete failed"));
  const data = (await res.json()) as InboxResponse;
  return data.entries ?? [];
}

async function markAllRequest(
  headers: Record<string, string>,
): Promise<InboxEntry[]> {
  const res = await fetch("/api/kody/inbox/read-all", {
    method: "POST",
    headers,
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "mark-all failed"));
  const data = (await res.json()) as InboxResponse;
  return data.entries ?? [];
}

async function appendRequest(
  headers: Record<string, string>,
  entries: InboxEntry[],
): Promise<InboxEntry[]> {
  const res = await fetch("/api/kody/inbox", {
    method: "POST",
    headers,
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "append failed"));
  const data = (await res.json()) as InboxResponse;
  return data.entries ?? [];
}

export interface UseInboxResult {
  entries: InboxEntry[];
  unread: InboxEntry[];
  read: InboxEntry[];
  unreadCount: number;
  isLoading: boolean;
  /** True during any fetch, including manual refetch over cached data. */
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
  markRead: (id: string) => Promise<void>;
  markUnread: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useInbox(options: { enabled?: boolean } = {}): UseInboxResult {
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const qc = useQueryClient();
  const key = inboxQueryKey(auth?.owner, auth?.repo);

  const enabled = (options.enabled ?? true) && !!auth;
  const query = useQuery<InboxEntry[]>({
    queryKey: key,
    queryFn: () => listInbox(headers),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: true,
  });

  const entries = useMemo(() => query.data ?? [], [query.data]);
  const { unread, read } = useMemo(() => {
    const u: InboxEntry[] = [];
    const r: InboxEntry[] = [];
    for (const e of entries) (e.readAt ? r : u).push(e);
    return { unread: u, read: r };
  }, [entries]);

  const markReadMut = useMutation({
    mutationFn: (id: string) =>
      patchEntry(headers, id, new Date().toISOString()),
    onSuccess: (next) => qc.setQueryData(key, next),
  });
  const markUnreadMut = useMutation({
    mutationFn: (id: string) => patchEntry(headers, id, null),
    onSuccess: (next) => qc.setQueryData(key, next),
  });
  const markAllMut = useMutation({
    mutationFn: () => markAllRequest(headers),
    onSuccess: (next) => qc.setQueryData(key, next),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => deleteEntryReq(headers, id),
    onSuccess: (next) => qc.setQueryData(key, next),
  });

  return {
    entries,
    unread,
    read,
    unreadCount: unread.length,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
    markRead: async (id) => {
      await markReadMut.mutateAsync(id);
    },
    markUnread: async (id) => {
      await markUnreadMut.mutateAsync(id);
    },
    markAllRead: async () => {
      await markAllMut.mutateAsync();
    },
    remove: async (id) => {
      await removeMut.mutateAsync(id);
    },
  };
}

/**
 * Lower-overhead variant for the nav badge — just the unread count, no
 * derived arrays, no mutations.
 */
export function useInboxUnreadCount(): number {
  const { unreadCount } = useInbox();
  return unreadCount;
}

/** Used by the watcher to push newly-found entries server-side. */
export function useInboxAppend(): (entries: InboxEntry[]) => Promise<void> {
  const { auth } = useAuth();
  const qc = useQueryClient();
  return async (entries) => {
    if (!auth || entries.length === 0) return;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...buildAuthHeaders(auth),
    };
    const next = await appendRequest(headers, entries);
    qc.setQueryData(inboxQueryKey(auth.owner, auth.repo), next);
  };
}
