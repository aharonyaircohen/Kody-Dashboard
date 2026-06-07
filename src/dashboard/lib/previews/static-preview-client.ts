/**
 * @fileType api-client
 * @domain previews
 * @pattern browser-fetch
 * @ai-summary Browser-side upload + teardown for static-file previews,
 *   hitting `/api/kody/previews/static`. Used by the Preview workspace's
 *   environment switcher: upload a file → get a live Fly URL (added as
 *   an environment); remove that environment → destroy the Fly app.
 *
 *   `authHeaders()` reuses the same stored PAT the rest of the dashboard
 *   uses, and the upload deliberately does NOT set a content-type so the
 *   browser adds the multipart boundary (silently setting
 *   `application/json` is the classic FormData bug here).
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
