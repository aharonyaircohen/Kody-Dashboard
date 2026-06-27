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
 *   repo      owner/name (must match the authenticated repo)
 *   pr        PR number (integer)
 *   branch    Branch name
 *
 * Response:
 *   { ticket: string, expiresAt: number }  — ticket is base64url encoded
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { flyHostname } from "@dashboard/lib/previews/fly-previews";
import { previewAppName } from "@dashboard/lib/previews/preview-key";
import {
  mintBranchPreviewTicket,
  mintPreviewTicket,
} from "@dashboard/lib/preview-token";

// TTL for preview tickets: 4 hours
const TICKET_TTL_SEC = 4 * 60 * 60;

const QuerySchema = z
  .object({
    repo: z.string().regex(/^[^/]+\/[^/]+$/, "repo must be owner/name"),
    pr: z.coerce
      .number()
      .int()
      .positive("pr must be a positive integer")
      .optional(),
    branch: z.string().min(1).max(255).optional(),
  })
  .refine((value) => Boolean(value.pr) !== Boolean(value.branch), {
    message: "provide exactly one of pr or branch",
    path: ["pr"],
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
    pr: searchParams.get("pr") ?? undefined,
    branch: searchParams.get("branch") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_params", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const expectedRepo = `${auth.owner}/${auth.repo}`;
  if (parsed.data.repo !== expectedRepo) {
    return NextResponse.json({ error: "repo_mismatch" }, { status: 403 });
  }

  const isPrPreview = Boolean(parsed.data.pr);
  const { ticket, expiresAt } = isPrPreview
    ? mintPreviewTicket(parsed.data.repo, parsed.data.pr!, TICKET_TTL_SEC)
    : mintBranchPreviewTicket(
        parsed.data.repo,
        parsed.data.branch!,
        TICKET_TTL_SEC,
      );
  const appName = previewAppName(
    isPrPreview
      ? { repo: parsed.data.repo, pr: parsed.data.pr! }
      : { repo: parsed.data.repo, branch: parsed.data.branch! },
  );
  const url = new URL(flyHostname(appName));
  url.searchParams.set("kp", ticket);

  return NextResponse.json({ ticket, expiresAt, url: url.toString() });
}
