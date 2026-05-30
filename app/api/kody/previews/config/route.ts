/**
 * @fileType api-endpoint
 * @domain previews
 * @pattern repo-config-toggle
 *
 * GET  /api/kody/previews/config  — current { buildMode } from
 *                                   kody.config.json's `previews` block.
 * PATCH /api/kody/previews/config — { buildMode: "dev" | "prod" }.
 *
 * Stored under `previews.buildMode` so the engine can read it too if
 * we ever want preview behaviour to differ in the engine path.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import {
  getEngineConfig,
  writeConfigPatch,
} from "@dashboard/lib/engine/config";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";

type BuildMode = "dev" | "prod";

function parseMode(raw: unknown): BuildMode {
  return raw === "prod" ? "prod" : "dev";
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  try {
    const { config } = await getEngineConfig(octokit, auth.owner, auth.repo);
    const raw = (config as { previews?: { buildMode?: string } })?.previews
      ?.buildMode;
    return NextResponse.json({ buildMode: parseMode(raw) });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "previews.config: GET failed",
    );
    return NextResponse.json(
      { error: "read_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  let body: { buildMode?: unknown };
  try {
    body = (await req.json()) as { buildMode?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.buildMode !== "dev" && body.buildMode !== "prod") {
    return NextResponse.json(
      { error: "bad_buildMode", message: "buildMode must be 'dev' or 'prod'" },
      { status: 400 },
    );
  }

  try {
    await writeConfigPatch(
      octokit,
      auth.owner,
      auth.repo,
      { previewBuildMode: body.buildMode },
      `chore(kody): preview buildMode=${body.buildMode}`,
    );
    return NextResponse.json({ ok: true, buildMode: body.buildMode });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "previews.config: PATCH failed",
    );
    return NextResponse.json(
      { error: "write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
