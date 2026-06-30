/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-image-save-route
 *
 * POST /api/kody/brain/image starts an async full-image save.
 * GET /api/kody/brain/image?jobId=... polls it and records the GHCR ref.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { resolveBrainService } from "@dashboard/lib/brain/service-resolver";
import {
  clearBrainImageSave,
  readBrainImage,
  readBrainImageSave,
  writeBrainImage,
  writeBrainImageSave,
  type BrainImageSaveFile,
} from "@dashboard/lib/brain/store";
import {
  brainGhcrImageRef,
  brainImageBuildCommand,
  brainImageTag,
} from "@dashboard/lib/brain/image-save";
import { brainGhcrAuth } from "@dashboard/lib/brain/image-runtime";
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
import {
  getTerminalBridgeExecJob,
  startTerminalBridgeLocalExecJob,
  type TerminalBridgeExecJob,
} from "@dashboard/lib/terminal/bridge-exec-client";
import { ensureTerminalBridge } from "@dashboard/lib/terminal/bridge-fly";
import { mintTerminalBridgeToken } from "@dashboard/lib/terminal/terminal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SAVE_JOB_TIMEOUT_MS = 840_000;
const SAVE_JOB_OUTPUT_BYTES = 8 * 1024 * 1024;

function imageRefFromJob(job: TerminalBridgeExecJob): string {
  const match = job.stdout.match(/__KODY_BRAIN_IMAGE_REF=(ghcr\.io\/[^\s]+)/);
  if (!match?.[1]) {
    throw new Error("Brain image build finished without an image ref");
  }
  return match[1];
}

function jobMessage(job: TerminalBridgeExecJob): string {
  return (
    job.stderr.trim().slice(0, 500) ||
    job.error ||
    `Brain image build failed${job.code == null ? "" : ` with exit ${job.code}`}`
  );
}

function savePollResponse(
  save: BrainImageSaveFile,
  job: TerminalBridgeExecJob,
) {
  return {
    ok: true,
    status: job.status,
    jobId: save.jobId,
    app: save.app,
    machineId: save.machineId,
    imageRef: save.expectedImageRef,
    startedAt: save.startedAt,
    updatedAt: save.updatedAt,
  };
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
  const flyToken = ctx.context.flyToken;

  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );

  try {
    const brain = await resolveBrainService({
      flyToken,
      account: ctx.context.account,
      githubToken: ctx.context.githubToken,
      orgSlug: ctx.context.flyOrgSlug,
      defaultRegion: ctx.context.flyDefaultRegion,
    });
    const app = brain.app;
    const machineId = brain.machineId;
    if (brain.state === "off" || !machineId || !brain.url) {
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
      token: flyToken,
      orgSlug: brain.orgSlug,
      defaultRegion: brain.defaultRegion,
    });
    const ghcr = brainGhcrAuth({
      allSecrets: ctx.context.allSecrets,
      githubToken: ctx.context.githubToken,
      account: ctx.context.account,
    });
    const token = mintTerminalBridgeToken({
      owner: ctx.context.owner,
      repo: ctx.context.repo,
      app,
      machineId,
      flyToken,
      ghcrToken: ghcr.token,
      localExec: true,
      ttlSeconds: 900,
      secret: bridge.secret,
    });
    const now = new Date();
    const tag = brainImageTag(now);
    const expectedImageRef = brainGhcrImageRef({
      owner: ctx.context.owner,
      account: ctx.context.account,
      tag,
    });
    const job = await startTerminalBridgeLocalExecJob({
      bridgeUrl: bridge.url,
      token,
      command: brainImageBuildCommand({
        app,
        machineId,
        orgSlug: brain.orgSlug,
        tag,
        baseImageRef: DEFAULT_IMAGE,
        imageRef: expectedImageRef,
        ghcrUser: ghcr.user,
      }),
      timeoutMs: SAVE_JOB_TIMEOUT_MS,
      maxOutputBytes: SAVE_JOB_OUTPUT_BYTES,
    });
    const save: BrainImageSaveFile = {
      version: 1,
      status: "running",
      jobId: job.id,
      app,
      machineId,
      bridgeApp: bridge.app,
      orgSlug: brain.orgSlug,
      defaultRegion: brain.defaultRegion,
      expectedImageRef,
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await writeBrainImageSave(
      ctx.context.account,
      ctx.context.githubToken,
      save,
    );

    return NextResponse.json(
      {
        ok: true,
        status: "running",
        jobId: job.id,
        app,
        machineId,
        imageRef: expectedImageRef,
        startedAt: save.startedAt,
      },
      { status: 202 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, owner: ctx.context.owner, repo: ctx.context.repo },
      "brain image save start failed",
    );
    return NextResponse.json(
      { error: "brain_image_save_start_failed", message },
      { status: 502 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json({ error: "fly_token_missing" }, { status: 400 });
  }
  const flyToken = ctx.context.flyToken;
  const requestedJobId = req.nextUrl.searchParams.get("jobId")?.trim();

  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );

  try {
    const save = await readBrainImageSave(
      ctx.context.account,
      ctx.context.githubToken,
    );
    if (!save) {
      return NextResponse.json({ ok: true, status: "idle" });
    }
    if (requestedJobId && save.jobId !== requestedJobId) {
      return NextResponse.json(
        { error: "job_not_found", message: "Brain image save job not found." },
        { status: 404 },
      );
    }

    const bridge = await ensureTerminalBridge({
      token: flyToken,
      orgSlug: save.orgSlug,
      defaultRegion: save.defaultRegion,
    });
    const token = mintTerminalBridgeToken({
      owner: ctx.context.owner,
      repo: ctx.context.repo,
      app: save.app,
      flyToken,
      localExec: true,
      ttlSeconds: 120,
      secret: bridge.secret,
    });
    const job = await getTerminalBridgeExecJob({
      bridgeUrl: bridge.url,
      token,
      jobId: save.jobId,
    });

    if (job.status === "running") {
      return NextResponse.json(savePollResponse(save, job));
    }

    if (job.status === "failed") {
      const failed: BrainImageSaveFile = {
        ...save,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: jobMessage(job),
      };
      await writeBrainImageSave(
        ctx.context.account,
        ctx.context.githubToken,
        failed,
      );
      return NextResponse.json(
        {
          ok: false,
          status: "failed",
          jobId: save.jobId,
          message: failed.error,
        },
        { status: 500 },
      );
    }

    const imageRef = imageRefFromJob(job);
    if (imageRef !== save.expectedImageRef) {
      throw new Error("Brain image build returned an unexpected image ref");
    }
    const previous = await readBrainImage(
      ctx.context.account,
      ctx.context.githubToken,
    ).catch(() => null);
    await writeBrainImage(ctx.context.account, ctx.context.githubToken, {
      version: 1,
      imageRef,
      createdAt: previous?.createdAt ?? save.startedAt,
      updatedAt: new Date().toISOString(),
    });
    await clearBrainImageSave(ctx.context.account, ctx.context.githubToken);

    return NextResponse.json({
      ok: true,
      status: "completed",
      jobId: save.jobId,
      imageRef,
      app: save.app,
      machineId: save.machineId,
      startedAt: save.startedAt,
      finishedAt: job.finishedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, owner: ctx.context.owner, repo: ctx.context.repo },
      "brain image save status failed",
    );
    return NextResponse.json(
      { error: "brain_image_save_status_failed", message },
      { status: 502 },
    );
  } finally {
    clearGitHubContext();
  }
}
