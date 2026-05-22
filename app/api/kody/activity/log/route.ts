/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern activity-log-api
 * @ai-summary GET /api/kody/activity/log — the "Log" tab of the Activity
 *   page. Merges two tiers of the audit trail:
 *     1. the durable, cross-instance ring stored in the `kody:audit-log`
 *        manifest issue (read via the cached/ETag path — no fresh budget
 *        spend on an unchanged log), and
 *     2. the in-memory ring on this serverless instance (covers the brief
 *        window before an after()-scheduled durable write lands).
 *   De-duped by id, newest-first. Falls back to in-memory only when there's
 *   no repo context (or GitHub is unreachable), so the tab never hard-fails.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { getActionLog, type AuditEvent } from "@dashboard/lib/activity/action-log";
import { readAuditDurable } from "@dashboard/lib/activity/audit-store";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const inMemory = getActionLog();

  let durable: AuditEvent[] = [];
  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    try {
      setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
      durable = await readAuditDurable();
    } catch {
      // Fall back to in-memory only — never hard-fail the Log tab.
    } finally {
      clearGitHubContext();
    }
  }

  // Merge newest-first, de-duping by id (in-memory may briefly hold an entry
  // that's also already durable, or vice-versa).
  const byId = new Map<string, AuditEvent>();
  for (const e of [...durable, ...inMemory]) {
    if (!byId.has(e.id)) byId.set(e.id, e);
  }
  const entries = [...byId.values()].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  );

  return NextResponse.json({
    entries,
    total: entries.length,
    computedAt: new Date().toISOString(),
  });
}
