/**
 * @fileType api-client
 * @domain preview
 * @pattern browser-fetch
 * @ai-summary Browser-side helpers for repo-backed static views stored under
 * `.kody/views/<id>` in the connected consumer repo.
 */
"use client";

import { getStoredAuth, NoTokenError } from "../api";
import { repoViewIdFromPath } from "../preview-environments";

export interface UploadedRepoView {
  id: string;
  name: string;
  url: string;
  repoPath: string;
  files: string[];
  htmlUrl: string | null;
}

export interface RepoViewTicket {
  token: string;
  expiresAt: number;
}

function authHeaders(): Record<string, string> {
  const auth = getStoredAuth();
  if (!auth) throw new NoTokenError("No auth");
  return {
    "x-kody-token": auth.token,
    "x-kody-owner": auth.owner,
    "x-kody-repo": auth.repo,
  };
}

function uploadName(file: File): string {
  const maybePath = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  return maybePath && maybePath.trim() ? maybePath : file.name;
}

export async function uploadRepoView(
  fileOrFiles: File | readonly File[],
): Promise<UploadedRepoView> {
  const form = new FormData();
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  for (const file of files) {
    form.append("file", file, uploadName(file));
  }
  const res = await fetch("/api/kody/views", {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      body.message ?? body.error ?? `View upload failed (${res.status})`,
    );
  }
  return (await res.json()) as UploadedRepoView;
}

export async function deleteRepoView(repoViewPath: string): Promise<void> {
  const viewId = repoViewIdFromPath(repoViewPath);
  if (!viewId) return;
  const res = await fetch(
    `/api/kody/views?view=${encodeURIComponent(viewId)}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      body.message ?? body.error ?? `View delete failed (${res.status})`,
    );
  }
}

export async function mintRepoViewTicket(
  viewId: string,
): Promise<RepoViewTicket> {
  const res = await fetch(
    `/api/kody/views/ticket?view=${encodeURIComponent(viewId)}`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      body.message ?? body.error ?? `View ticket failed (${res.status})`,
    );
  }
  return (await res.json()) as RepoViewTicket;
}

export function tokenizeRepoViewUrl(url: string, token: string): string {
  const base =
    typeof window === "undefined"
      ? "http://kody.local"
      : window.location.origin;
  const parsed = new URL(url, base);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const prefix = ["api", "kody", "views"];
  const matchesPrefix = prefix.every((part, index) => parts[index] === part);
  if (!matchesPrefix || parts[3] === "_t" || !parts[3]) return url;
  const viewId = parts[3];
  const rest = parts.slice(4).map(encodeURIComponent).join("/");
  const path = `/api/kody/views/_t/${encodeURIComponent(token)}/${viewId}${
    rest ? `/${rest}` : ""
  }`;
  return `${path}${parsed.search}${parsed.hash}`;
}
