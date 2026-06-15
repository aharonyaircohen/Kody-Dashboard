/**
 * @fileType api-endpoint
 * @domain preview
 * @pattern repo-backed-static-view-ticket
 * @ai-summary Auth-gated endpoint that mints a short-lived encrypted access
 * token for one `.kody/views/<view-id>` folder.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { mintRepoViewToken } from "@dashboard/lib/view-token";

export const runtime = "nodejs";

const QuerySchema = z.object({
  view: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({ view: searchParams.get("view") });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_params", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const { token, expiresAt } = mintRepoViewToken({
      owner: auth.owner,
      repo: auth.repo,
      viewId: parsed.data.view,
      githubToken: auth.token,
    });
    return NextResponse.json({ token, expiresAt });
  } catch (err) {
    return NextResponse.json(
      { error: "ticket_failed", message: (err as Error).message },
      { status: 503 },
    );
  }
}
