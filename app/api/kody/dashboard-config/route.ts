/**
 * @fileType api-endpoint
 * @domain dashboard-config
 * @pattern repo-config
 * @ai-summary GET — return per-repo dashboard config from `.kody/dashboard.json`.
 *   PUT — upsert config (currently `defaultPreviewUrl`). Plain JSON, not encrypted.
 *   Used by the Vibe page to remember the default preview URL across users.
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
  invalidateDashboardConfigCache,
  readDashboardConfig,
  writeDashboardConfig,
  type DashboardConfig,
} from "@dashboard/lib/dashboard-config/store";
import { logger } from "@dashboard/lib/logger";

const UpsertSchema = z.object({
  defaultPreviewUrl: z
    .string()
    .url({ message: "Must be a valid URL" })
    .max(2048)
    .optional()
    .or(z.literal("")),
  defaultChatEntryKey: z.string().max(256).optional().or(z.literal("")),
  brainFlyChatEnabled: z.boolean().optional(),
  actorLogin: z.string().optional(),
});

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
    const { doc } = await readDashboardConfig(octokit, auth.owner, auth.repo);
    return NextResponse.json({ config: doc });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "dashboard-config: read failed",
    );
    return NextResponse.json(
      { error: "config_read_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
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

  const parsed = UpsertSchema.safeParse(body);
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

  try {
    const { doc, sha } = await readDashboardConfig(
      octokit,
      auth.owner,
      auth.repo,
      {
        force: true,
      },
    );
    // Partial merge: only fields present in the request body are
    // overwritten, so a Vibe-page save and a chat-default save don't
    // clobber each other's value.
    const bodyKeys = body && typeof body === "object" ? body : {};
    const next: DashboardConfig = { ...doc, version: 1 };
    let commitMessage = `chore(dashboard): update dashboard config`;
    if ("defaultPreviewUrl" in bodyKeys) {
      const trimmed = parsed.data.defaultPreviewUrl?.trim();
      next.defaultPreviewUrl = trimmed ? trimmed : undefined;
      commitMessage = `chore(dashboard): set default preview URL`;
    }
    if ("defaultChatEntryKey" in bodyKeys) {
      const key = parsed.data.defaultChatEntryKey?.trim();
      next.defaultChatEntryKey = key ? key : undefined;
      commitMessage = `chore(dashboard): set default chat entry`;
    }
    if ("brainFlyChatEnabled" in bodyKeys) {
      next.brainFlyChatEnabled = parsed.data.brainFlyChatEnabled === true;
      commitMessage = `chore(dashboard): ${
        next.brainFlyChatEnabled ? "enable" : "disable"
      } Brain (Fly) in chat`;
    }
    await writeDashboardConfig(
      octokit,
      auth.owner,
      auth.repo,
      next,
      sha,
      commitMessage,
    );
    invalidateDashboardConfigCache(auth.owner, auth.repo);
    return NextResponse.json({ ok: true, config: next });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "dashboard-config: write failed",
    );
    return NextResponse.json(
      { error: "config_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
