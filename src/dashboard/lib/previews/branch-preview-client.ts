/**
 * @fileType api-client
 * @domain previews
 * @pattern browser-fetch
 * @ai-summary Browser-side helper for resolving tracked Fly branch previews.
 */
"use client";

import {
  getStoredAuth,
  NoTokenError,
  redirectToLogin,
  SessionExpiredError,
} from "../api";

export type BranchPreviewState =
  | "building"
  | "failed"
  | "pending"
  | "starting"
  | "running"
  | "unknown";

export interface BranchPreviewSummary {
  branch: string;
  state: BranchPreviewState;
  url: string | null;
}

export interface BranchPreviewsResponse {
  previews: BranchPreviewSummary[];
  flyConfigured: boolean;
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

async function readErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    message?: unknown;
    error?: unknown;
  } | null;
  if (typeof body?.message === "string" && body.message.trim()) {
    return body.message;
  }
  if (typeof body?.error === "string" && body.error.trim()) {
    return body.error;
  }
  return `${fallback} (${res.status})`;
}

export async function fetchBranchPreviews(): Promise<BranchPreviewsResponse> {
  const res = await fetch("/api/kody/previews/branch", {
    headers: authHeaders(),
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new SessionExpiredError("Session expired");
  }
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Failed to load previews"));
  }

  const body = (await res.json()) as {
    previews?: Array<{
      branch?: unknown;
      state?: unknown;
      url?: unknown;
    }>;
    flyConfigured?: unknown;
  };

  return {
    flyConfigured: body.flyConfigured === true,
    previews: (body.previews ?? [])
      .filter((p): p is { branch: string; state?: unknown; url?: unknown } =>
        Boolean(p && typeof p.branch === "string"),
      )
      .map((p) => ({
        branch: p.branch,
        state:
          typeof p.state === "string"
            ? (p.state as BranchPreviewState)
            : "unknown",
        url: typeof p.url === "string" ? p.url : null,
      })),
  };
}
