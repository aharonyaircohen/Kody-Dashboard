/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern activity-log-api
 * @ai-summary GET /api/kody/activity/log — the "Log" tab of the Activity
 *   page. Returns the in-memory dashboard-action ring buffer
 *   (`getActionLog`). No GitHub calls at all, so it's free and safe to
 *   poll; entries are per serverless instance (see action-log.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth } from "@dashboard/lib/auth";
import { getActionLog } from "@dashboard/lib/activity/action-log";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const entries = getActionLog();
  return NextResponse.json({
    entries,
    total: entries.length,
    computedAt: new Date().toISOString(),
  });
}
