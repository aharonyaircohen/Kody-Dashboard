/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern preview-ticket-api
 *
 * GET /api/kody/previews/ticket — mint a signed preview access ticket.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import {
  mintBranchPreviewTicket,
  mintPreviewTicket,
} from "@dashboard/lib/preview-token";

const TICKET_TTL_SEC = 4 * 60 * 60;

const QuerySchema = z
  .object({
    repo: z.string().regex(/^[^/]+\/[^/]+$/, "repo must be owner/name"),
    pr: z.coerce.number().int().positive().optional(),
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

  const { ticket, expiresAt } = parsed.data.pr
    ? mintPreviewTicket(parsed.data.repo, parsed.data.pr, TICKET_TTL_SEC)
    : mintBranchPreviewTicket(
        parsed.data.repo,
        parsed.data.branch!,
        TICKET_TTL_SEC,
      );

  return NextResponse.json({ ticket, expiresAt });
}
