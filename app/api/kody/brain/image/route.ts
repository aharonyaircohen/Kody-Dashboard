/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-image-save-route
 *
 * POST /api/kody/brain/image
 *
 * Saves the current per-user Brain home state as a Fly registry image and
 * records the resulting image ref in `users/<login>/data/brain-image.json`.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireKodyAuth } from "@dashboard/lib/auth";
import {
  readBrainImage,
  writeBrainImage,
} from "@dashboard/lib/brain/store";
import { resolveBrainService } from "@dashboard/lib/brain/service-resolver";
import {
  brainFlyImageRef,
  brainImageBuildCommand,
  brainImageTag,
} from "@dashboard/lib/brain/image-save";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import {
  DEFAULT_IMAGE,
  waitForBrainHealth,
} from "@dashboard/lib/runners/brain-fly";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";
import { ensureTerminalBridge } from "@dashboard/lib/terminal/bridge-fly";
import { mintTerminalBridgeToken } from "@dashboard/lib/terminal/terminal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  app: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
    .optional(),
  machineId: z.string().trim().min(1).max(120).optional(),
});

function bridgeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function runBrainExport(input: {
  bridgeUrl: string;
  token: string;
  command: string;
}): Promise<string> {
  const res = await fetch(`${bridgeBaseUrl(input.bridgeUrl)}/exec`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      command: input.command,
      local: true,
      timeoutMs: 240_000,
      maxOutputBytes: 8 * 1024 * 1024,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    code?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
  };
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? `Brain export failed (HTTP ${res.status})`);
  }
  if (body.code !== 0) {
    throw new Error(
      `Brain export failed with exit ${body.code}: ${body.stderr ?? ""}`,
    );
  }
  const match = (body.stdout ?? "").match(
    /__KODY_BRAIN_IMAGE_REF=(registry\.fly\.io\/[^\s]+)/,
  );
  if (!match?.[1]) {
    throw new Error("Brain image build finished without an image ref");
  }
  return match[1];
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error:
          "Brain image save needs a Fly Machines token. Add FLY_API_TOKEN to the repo Secrets vault.",
      },
      { status: 400 },
    );
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
  if (parsed.data.app && !parsed.data.machineId) {
    return NextResponse.json(
      {
        error: "machine_required",
        message: "Selected Brain app needs a machine id.",
      },
      { status: 400 },
    );
  }

  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );

  try {
    const brain = await resolveBrainService({
      flyToken: ctx.context.flyToken,
      account: ctx.context.account,
      githubToken: ctx.context.githubToken,
      orgSlug: ctx.context.flyOrgSlug,
      defaultRegion: ctx.context.flyDefaultRegion,
      appNameOverride: parsed.data.app,
      machineIdOverride: parsed.data.machineId,
    });
    const app = brain.app;
    const machineId = parsed.data.machineId ?? brain.machineId;
    if (
      brain.state === "off" ||
      !machineId ||
      !brain.url ||
      (parsed.data.machineId && brain.machineId !== parsed.data.machineId)
    ) {
      return NextResponse.json(
        {
          error: "brain_not_found",
          message: "No Brain machine found to save.",
          reason: brain.reason,
        },
        { status: 404 },
      );
    }
    await waitForBrainHealth(brain.url, 120_000);

    const bridge = await ensureTerminalBridge({
      token: ctx.context.flyToken,
      orgSlug: ctx.context.flyOrgSlug,
      defaultRegion: ctx.context.flyDefaultRegion,
    });
    const token = mintTerminalBridgeToken({
      owner: ctx.context.owner,
      repo: ctx.context.repo,
      app,
      machineId,
      flyToken: ctx.context.flyToken,
      localExec: true,
      ttlSeconds: 300,
      secret: bridge.secret,
    });
    const now = new Date();
    const tag = brainImageTag(now);
    const expectedImageRef = brainFlyImageRef(app, tag);
    const imageRef = await runBrainExport({
      bridgeUrl: bridge.url,
      token,
      command: brainImageBuildCommand({
        app,
        machineId,
        tag,
        baseImageRef: DEFAULT_IMAGE,
      }),
    });
    if (imageRef !== expectedImageRef) {
      throw new Error("Brain image build returned an unexpected image ref");
    }

    const previous = await readBrainImage(
      ctx.context.account,
      ctx.context.githubToken,
    ).catch(() => null);
    await writeBrainImage(ctx.context.account, ctx.context.githubToken, {
      version: 1,
      imageRef,
      createdAt: previous?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    });

    return NextResponse.json({
      ok: true,
      imageRef,
      app,
      machineId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, owner: ctx.context.owner, repo: ctx.context.repo },
      "brain image save failed",
    );
    return NextResponse.json(
      { error: "brain_image_save_failed", message },
      { status: 502 },
    );
  } finally {
    clearGitHubContext();
  }
}
