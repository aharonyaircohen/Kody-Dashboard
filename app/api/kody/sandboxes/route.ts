/**
 * @fileType api-endpoint
 * @domain sandboxes
 * @pattern local-sandbox-list-create
 *
 * GET/POST local dev sandbox profiles for the chat terminal.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth, requireKodyAuth } from "@dashboard/lib/auth";
import {
  createLocalSandbox,
  listLocalSandboxes,
  saveLocalSandboxSnapshot,
} from "@dashboard/lib/sandboxes/local-sandboxes";
import { publishGitHubActionsSandboxSnapshot } from "@dashboard/lib/sandboxes/github-actions-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1).max(80).optional(),
  runtime: z.enum(["local", "github-actions"]).optional(),
  sourceSandboxId: z.string().min(1).max(80).optional(),
});

function publicSandbox(
  sandbox: Awaited<ReturnType<typeof createLocalSandbox>>,
) {
  return {
    id: sandbox.id,
    name: sandbox.name,
    runtime: sandbox.runtime,
    scope: sandbox.scope,
    createdAt: sandbox.createdAt,
    updatedAt: sandbox.updatedAt,
    snapshotUpdatedAt: sandbox.snapshotUpdatedAt ?? null,
  };
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const sandboxes = await listLocalSandboxes(auth);
  return NextResponse.json({
    ok: true,
    sandboxes: sandboxes.map(publicSandbox),
  });
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }
  try {
    let sandbox = await createLocalSandbox(auth, parsed.data);
    if (sandbox.runtime === "github-actions") {
      sandbox = await saveLocalSandboxSnapshot(auth, sandbox.id);
      await publishGitHubActionsSandboxSnapshot(req, auth, sandbox);
    }
    return NextResponse.json({ ok: true, sandbox: publicSandbox(sandbox) });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create sandbox";
    return NextResponse.json(
      { error: "sandbox_create_failed", message },
      { status: 500 },
    );
  }
}
