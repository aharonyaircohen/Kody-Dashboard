/**
 * @fileType api-endpoint
 * @domain previews
 * @pattern previews-config-api
 *
 * GET/PATCH /api/kody/previews/config — read and edit the per-repo preview
 * machine knobs stored at kody.config.json `fly.previews` (size, idle-suspend,
 * health-check, TTL). These are plain config, NOT secrets — only the Fly token
 * lives in the vault. Powers the Fly panel's Previews card.
 *
 * GET returns both the raw stored override (so the UI can show "default" vs
 * "set") and the fully-resolved values the builder actually uses.
 *
 * Auth: requireKodyAuth + verifyActorLogin, same as the company config route.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@dashboard/lib/auth";
import {
  getEngineConfig,
  resolveFlyPreviews,
  writeConfigPatch,
} from "@dashboard/lib/engine/config";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  try {
    const { config } = await getEngineConfig(octokit, auth.owner, auth.repo);
    return NextResponse.json({
      stored: config.fly?.previews ?? {},
      resolved: resolveFlyPreviews(config),
    });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "previews-config: read failed",
    );
    return NextResponse.json(
      { error: "config_read_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

// Bounds keep a fat-fingered value from booting an absurdly-sized (and
// expensive) machine, or an unreachable TTL. Mirror the resolver's accepted
// shapes.
const PatchSchema = z
  .object({
    previews: z
      .object({
        cpus: z.number().int().min(1).max(16).optional(),
        memoryMb: z.number().int().min(256).max(32768).optional(),
        builderCpus: z.number().int().min(1).max(16).optional(),
        builderMemoryMb: z.number().int().min(256).max(32768).optional(),
        idleSuspend: z.boolean().optional(),
        healthCheck: z.boolean().optional(),
        ttlDays: z.number().int().min(0).max(365).optional(),
      })
      .nullable(),
    actorLogin: z.string().optional(),
  })
  .refine((b) => b.previews !== undefined, { message: "no_fields" });

export async function PATCH(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const verify = await verifyActorLogin(req, parsed.data.actorLogin);
  if ("status" in verify) return verify;
  const actorLogin = verify.identity.login;

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  try {
    await writeConfigPatch(
      octokit,
      auth.owner,
      auth.repo,
      { flyPreviews: parsed.data.previews },
      `chore(kody): update preview machine config (${actorLogin})`,
    );
    const { config } = await getEngineConfig(octokit, auth.owner, auth.repo, {
      force: true,
    });
    return NextResponse.json({
      stored: config.fly?.previews ?? {},
      resolved: resolveFlyPreviews(config),
    });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "previews-config: write failed",
    );
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "config_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
