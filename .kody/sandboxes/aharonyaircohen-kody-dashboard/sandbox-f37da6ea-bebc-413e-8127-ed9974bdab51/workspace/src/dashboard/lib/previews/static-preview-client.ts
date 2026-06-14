/**
 * @fileType api-client
 * @domain previews
 * @pattern browser-fetch
 * @ai-summary Browser-side `fetch` helpers for the static-preview
 *   endpoints (`/api/kody/previews/static`). The Preview workspace's
 *   environment switcher wires these so a user-uploaded file becomes a
 *   live Fly URL with one click, and removing that environment tears
 *   it down. Trap: this is the ONLY client file in this folder that
 *   runs in the browser — it must stay free of server-only imports
 *   (no Octokit, no node:crypto) or the client bundle will fail to build.
 *
 * Browser-side upload + teardown for static-file previews, hitting
 * `/api/kody/previews/static`. Used by the Preview workspace's environment
 * switcher: upload a file → get a live Fly URL (added as an environment);
 * remove that environment → destroy the Fly app.
 */
"use client";

import { getStoredAuth, NoTokenError } from "../api";

export interface UploadedStaticPreview {
  id: string;
  name: string;
  url: string;
  state: string;
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

export async function uploadStaticPreview(
  file: File,
): Promise<UploadedStaticPreview> {
  const form = new FormData();
  form.append("file", file);
  // Don't set content-type — the browser adds the multipart boundary.
  const res = await fetch("/api/kody/previews/static", {
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
      body.message ?? body.error ?? `Upload failed (${res.status})`,
    );
  }
  return (await res.json()) as UploadedStaticPreview;
}

export async function destroyStaticPreview(id: string): Promise<void> {
  const res = await fetch("/api/kody/previews/static", {
    method: "DELETE",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Destroy failed (${res.status})`);
  }
}
