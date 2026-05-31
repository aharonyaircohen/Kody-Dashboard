/**
 * @fileType api-client
 * @domain dashboard-config
 * @pattern browser-fetch
 * @ai-summary Browser-side read/write for `.kody/dashboard.json` via
 *   `/api/kody/dashboard-config`. Shared by the Vibe page (default preview URL)
 *   and the Preview workspace (named environments) so both hit one merge-safe
 *   PUT and one GET shape. The route partial-merges, so a patch only touches the
 *   fields it sends.
 */
"use client";

import {
  getStoredAuth,
  redirectToLogin,
  NoTokenError,
  SessionExpiredError,
} from "../api";
import type { PreviewEnvironment } from "../preview-environments";

export interface DashboardConfigDoc {
  version: 1;
  defaultPreviewUrl?: string;
  namedPreviews?: PreviewEnvironment[];
  brainFlyChatEnabled?: boolean;
}

export interface DashboardConfigResponse {
  config: DashboardConfigDoc;
}

export interface DashboardConfigPatch {
  defaultPreviewUrl?: string;
  namedPreviews?: PreviewEnvironment[];
  brainFlyChatEnabled?: boolean;
  actorLogin?: string;
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

export async function fetchDashboardConfig(): Promise<DashboardConfigResponse> {
  const res = await fetch("/api/kody/dashboard-config", {
    headers: authHeaders(),
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new SessionExpiredError("Session expired");
  }
  if (!res.ok) throw new Error(`Failed to load config (${res.status})`);
  return (await res.json()) as DashboardConfigResponse;
}

export async function saveDashboardConfig(
  patch: DashboardConfigPatch,
): Promise<DashboardConfigResponse> {
  const res = await fetch("/api/kody/dashboard-config", {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "Save failed");
    throw new Error(msg);
  }
  // PUT returns { ok, config }; normalise to the GET { config } shape so
  // callers can drop the result straight into the query cache.
  const data = (await res.json()) as { ok?: boolean; config: DashboardConfigDoc };
  return { config: data.config };
}
