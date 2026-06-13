/**
 * @fileType api-endpoint
 * @domain sandboxes
 * @pattern local-sandbox-delete
 *
 * DELETE one local dev sandbox profile.
 */
import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { deleteLocalSandbox } from "@dashboard/lib/sandboxes/local-sandboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    const deleted = await deleteLocalSandbox(auth, id);
    if (!deleted) {
      return NextResponse.json(
        { error: "sandbox_not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete sandbox";
    return NextResponse.json(
      { error: "sandbox_delete_failed", message },
      { status: 500 },
    );
  }
}
