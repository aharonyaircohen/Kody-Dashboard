/**
 * @fileType api-endpoint
 * @domain sandboxes
 * @pattern local-sandbox-save
 *
 * POST save an encrypted local filesystem snapshot for one sandbox.
 */
import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import { saveLocalSandboxSnapshot } from "@dashboard/lib/sandboxes/local-sandboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    const sandbox = await saveLocalSandboxSnapshot(auth, id);
    return NextResponse.json({
      ok: true,
      sandbox: {
        id: sandbox.id,
        name: sandbox.name,
        scope: sandbox.scope,
        createdAt: sandbox.createdAt,
        updatedAt: sandbox.updatedAt,
        snapshotUpdatedAt: sandbox.snapshotUpdatedAt ?? null,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save sandbox";
    return NextResponse.json(
      { error: "sandbox_save_failed", message },
      { status: message.includes("not found") ? 404 : 500 },
    );
  }
}
