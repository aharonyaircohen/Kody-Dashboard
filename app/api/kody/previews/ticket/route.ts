/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern preview-ticket-api
 *
 * GET /api/kody/previews/ticket — mint a signed preview access ticket.
 *
 * Auth-gated: requires a logged-in dashboard user (requireKodyAuth).
 * The ticket is a stateless HMAC — no DB, no session. The doorman in each
 * preview machine verifies it using a derived key (HKDF of KODY_MASTER_KEY
 * with info "kody-preview:v1") that was shipped to the machine at boot.
 *
 * Query params:
 *   repo   owner/name
 *   pr     PR number (integer)
 *
 * Response:
 *   { ticket: string, expiresAt: number }  — ticket is base64url encoded
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { mintPreviewTicket } from "@dashboard/lib/preview-token";

// TTL for preview tickets: 4 hours
const TICKET_TTL_SEC = 4 * 60 * 60;

const QuerySchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "repo must be owner/name"),
  pr: z.coerce.number().int().positive("pr must be a positive integer"),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    repo: searchParams.get("repo"),
    pr: searchParams.get("pr"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_params", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { ticket, expiresAt } = mintPreviewTicket(
    parsed.data.repo,
    parsed.data.pr,
    TICKET_TTL_SEC,
  );

  return NextResponse.json({ ticket, expiresAt });
}
