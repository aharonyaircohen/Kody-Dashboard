/**
 * @fileType api-endpoint
 * @domain preview
 * @pattern macros-api
 * @ai-summary Saved preview macros, stored in the configured state repo at `macros.json`.
 *   GET lists them; POST appends a new one ({ name, steps }); DELETE removes
 *   one by id (?id=). Mirrors the secrets route auth shape: header PAT for
 *   reads, verified actor + user octokit for the commits writes perform.
 *   Renaming is handled by the chat tool path (the UI doesn't need it yet).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import {
  readMacrosFile,
  addMacroToFile,
  deleteMacroFromFile,
} from "@dashboard/lib/macros-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PreviewAction shape (mirrors src/dashboard/lib/picker/protocol.ts). Kept
// permissive on extra fields so a future op variant doesn't reject saves.
const stepSchema = z
  .object({ op: z.enum(["click", "fill", "navigate", "scroll", "wait"]) })
  .passthrough();

const createSchema = z.object({
  name: z.string().min(1).max(64),
  steps: z.array(stepSchema).min(1),
  actorLogin: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });

  setGitHubContext(auth.owner, auth.repo, auth.token);
  try {
    const { macros } = await readMacrosFile();
    return NextResponse.json(
      { macros },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "macros_read_failed", message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const verify = await verifyActorLogin(req, parsed.data.actorLogin);
  if ("status" in verify) return verify;

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  setGitHubContext(auth.owner, auth.repo, auth.token);
  try {
    const macro = await addMacroToFile({
      octokit,
      name: parsed.data.name,
      steps: parsed.data.steps as never,
    });
    const { macros } = await readMacrosFile(octokit);
    return NextResponse.json({ ok: true, macro, macros });
  } catch (err) {
    return NextResponse.json(
      { error: "macros_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  const verify = await verifyActorLogin(req, undefined);
  if ("status" in verify) return verify;

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  setGitHubContext(auth.owner, auth.repo, auth.token);
  try {
    const removed = await deleteMacroFromFile({ octokit, id });
    if (!removed)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    const { macros } = await readMacrosFile(octokit);
    return NextResponse.json({ ok: true, macros });
  } catch (err) {
    return NextResponse.json(
      { error: "macros_delete_failed", message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
