/**
 * @fileType api-endpoint
 * @domain runner
 * @pattern fly-machine-action
 *
 * POST /api/kody/fly/machines/action — act on a single Fly machine from the
 * operator Machines table:
 *
 *   { app, machineId, action: "suspend" | "start" | "destroy" }
 *   { app, action: "destroyApp" }   // tears down the whole app (previews)
 *
 * Suspend/start are reversible; destroy / destroyApp are not, so the UI gates
 * them behind a confirm. Uses the connected repo's vault FLY_API_TOKEN.
 *
 * Auth: requireKodyAuth + verifyActorLogin (destructive → identity-checked).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { resolvePreviewConfigForOctokit } from "@dashboard/lib/previews/config";
import {
  destroyApp,
  destroyMachine,
  startMachine,
  suspendMachine,
} from "@dashboard/lib/previews/fly-previews";

export const runtime = "nodejs";

const Body = z
  .object({
    app: z.string().min(1).max(120),
    machineId: z.string().min(1).max(120).optional(),
    action: z.enum(["suspend", "start", "destroy", "destroyApp"]),
    actorLogin: z.string().optional(),
  })
  // Machine-scoped actions need a machineId; destroyApp doesn't.
  .refine((b) => b.action === "destroyApp" || !!b.machineId, {
    message: "machineId_required",
  });

export async function POST(req: NextRequest) {
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
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // Destructive actions are identity-checked; suspend/start are cheap+reversible.
  if (parsed.data.action === "destroy" || parsed.data.action === "destroyApp") {
    const verify = await verifyActorLogin(req, parsed.data.actorLogin);
    if ("status" in verify) return verify;
  }

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  const cfg = await resolvePreviewConfigForOctokit({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
  });
  if (!cfg) {
    return NextResponse.json({ error: "fly_token_missing" }, { status: 503 });
  }

  const { app, machineId, action } = parsed.data;
  try {
    switch (action) {
      case "suspend":
        await suspendMachine(app, machineId!, cfg);
        break;
      case "start":
        await startMachine(app, machineId!, cfg);
        break;
      case "destroy":
        await destroyMachine(app, machineId!, cfg);
        break;
      case "destroyApp":
        await destroyApp(app, cfg);
        break;
    }
    return NextResponse.json({ ok: true, app, machineId, action });
  } catch (err) {
    logger.error(
      { err, app, machineId, action },
      "fly-machines: action failed",
    );
    return NextResponse.json(
      { error: "action_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
