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
  readBrainRuntimeView,
  selectBrainRuntimeImage,
} from "@dashboard/lib/brain/runtime-manager";
import {
  readBrainRuntimeAuthority,
  type BrainRuntimeDrift,
} from "@dashboard/lib/brain/runtime-authority";
import {
  clearBrainImageSave,
  deleteBrainImage,
  readBrainImage,
  readBrainImageSave,
  writeBrainImage,
  writeBrainImageSave,
  type BrainImageFile,
  type BrainImageSaveFile,
  type BrainSavedImage,
} from "@dashboard/lib/brain/store";
import {
  brainGhcrImageRef,
  brainImageBuildCommand,
  brainImageSaveProgressFromOutput,
  brainImageTag,
} from "@dashboard/lib/brain/image-save";
import {
  brainImageCatalogFile,
  discoverBrainPackageImages,
  mergeBrainSavedImages,
  upsertBrainCatalogImageFile,
} from "@dashboard/lib/brain/image-catalog";
import {
  BRAIN_IMAGE_JOB_OUTPUT_BYTES,
  brainImageJobTimeoutMs,
} from "@dashboard/lib/brain/image-timeouts";
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

function imageRefFromJob(job: TerminalBridgeExecJob): string {
  const match = job.stdout.match(/__KODY_BRAIN_IMAGE_REF=(ghcr\.io\/[^\s]+)/);
  if (!match?.[1]) {
    throw new Error("Brain image build finished without an image ref");
  }
  return match[1];
}

function jobMessage(job: TerminalBridgeExecJob): string {
  const stderr = job.stderr.trim().slice(0, 500);
  if (stderr) return stderr;
  const stdoutTail = job.stdout.trim().slice(-500);
  if (job.error) {
    return stdoutTail ? `${job.error}\n${stdoutTail}` : job.error;
  }
  return stdoutTail
    ? `Brain image build failed${job.code == null ? "" : ` with exit ${job.code}`}\n${stdoutTail}`
    : `Brain image build failed${job.code == null ? "" : ` with exit ${job.code}`}`;
}

function savePollResponse(
  save: BrainImageSaveFile,
  job: TerminalBridgeExecJob,
) {
  const progress = brainImageSaveProgressFromOutput(job);
  return {
    ok: true,
    status: job.status,
    phase: progress.phase,
    message: progress.message,
    lastOutput: progress.lastOutput,
    jobId: save.jobId,
    app: save.app,
    machineId: save.machineId,
    imageRef: save.expectedImageRef,
    startedAt: save.startedAt,
    updatedAt: save.updatedAt,
  };
}

function imageManagementResponse(
  image: Awaited<ReturnType<typeof readBrainImage>>,
  runtime: Awaited<ReturnType<typeof readBrainRuntimeView>> | null,
  machine: { imageRef?: string; state?: string } | null = null,
  discoveredImages: BrainSavedImage[] = [],
  drift: BrainRuntimeDrift | null = null,
) {
  const images = mergeBrainSavedImages(image, discoveredImages);
  return {
    ok: true,
    imageRef: runtime?.desiredImageRef ?? image?.imageRef ?? null,
    runningImageRef: runtime?.runningImageRef ?? null,
    runningAt: runtime?.runningAt ?? null,
    runningApp: runtime?.runningApp ?? null,
    runningMachineId: runtime?.runningMachineId ?? null,
    machineImageRef: machine?.imageRef ?? null,
    machineState: machine?.state ?? null,
    runtime: runtime ?? null,
    drift,
    images,
    createdAt: image?.createdAt ?? null,
    updatedAt: image?.updatedAt ?? null,
  };
}

async function recordCompletedBrainImageSave(input: {
  account: string;
  githubToken: string;
  save: BrainImageSaveFile;
  imageRef: string;
  finishedAt?: string | null;
  lastOutput?: string;
}) {
  const previous = await readBrainImage(
    input.account,
    input.githubToken,
  ).catch(() => null);
  const now = new Date().toISOString();
  await writeBrainImage(
    input.account,
    input.githubToken,
    upsertBrainCatalogImageFile(
      previous,
      {
        imageRef: input.imageRef,
        createdAt: input.save.startedAt,
        updatedAt: now,
      },
      now,
    ),
  );
  await selectBrainRuntimeImage(
    input.account,
    input.githubToken,
    input.imageRef,
  );
  await clearBrainImageSave(input.account, input.githubToken);

  return {
    ok: true,
    status: "completed",
    phase: "completed",
    message: "Brain image saved",
    lastOutput: input.lastOutput,
    jobId: input.save.jobId,
    imageRef: input.imageRef,
    app: input.save.app,
    machineId: input.save.machineId,
    startedAt: input.save.startedAt,
    finishedAt: input.finishedAt ?? null,
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
    const brainFlyToken = brain.flyToken;
    if (brain.reason === "fly_access_denied") {
      return NextResponse.json(
        {
          error: "fly_access_denied",
          message: "Fly token cannot access this Brain app.",
          app: brain.app,
          org: brain.orgSlug,
          reason: brain.reason,
        },
        { status: 403 },
      );
    }
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
      token: brainFlyToken,
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
      orgSlug: brain.orgSlug,
      machineId,
      flyToken: brainFlyToken,
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
      timeoutMs: brainImageJobTimeoutMs(),
      maxOutputBytes: BRAIN_IMAGE_JOB_OUTPUT_BYTES,
    });
    const save: BrainImageSaveFile = {
      version: 1,
      status: "running",
      phase: "starting",
      message: "Starting Brain image save",
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
        phase: "starting",
        message: "Starting Brain image save",
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
  const requestedJobId = req.nextUrl.searchParams.get("jobId")?.trim();

  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );

  try {
    if (!requestedJobId) {
      const image = await readBrainImage(
        ctx.context.account,
        ctx.context.githubToken,
      );
      const ghcr = brainGhcrAuth({
        allSecrets: ctx.context.allSecrets,
        githubToken: ctx.context.githubToken,
        account: ctx.context.account,
      });
      const discoveredImages = await discoverBrainPackageImages({
        owner: ctx.context.owner,
        repo: ctx.context.repo,
        account: ctx.context.account,
        githubToken: ghcr.token,
      });
      const save = await readBrainImageSave(
        ctx.context.account,
        ctx.context.githubToken,
      );
      const authority = await readBrainRuntimeAuthority({
        flyToken: ctx.context.flyToken,
        account: ctx.context.account,
        githubToken: ctx.context.githubToken,
        orgSlug: ctx.context.flyOrgSlug,
        defaultRegion: ctx.context.flyDefaultRegion,
        allowServiceFailure: true,
      });
      return NextResponse.json({
        ...imageManagementResponse(
          image,
          authority.runtime,
          authority.service
            ? {
                imageRef: authority.service.machineImageRef,
                state: authority.service.state,
              }
            : null,
          discoveredImages,
          authority.drift,
        ),
        save: save
          ? {
              status: save.status,
              phase: save.phase ?? "starting",
              message: save.message,
              lastOutput: save.lastOutput,
              jobId: save.jobId,
              imageRef: save.expectedImageRef,
              startedAt: save.startedAt,
              updatedAt: save.updatedAt,
              error: save.error,
            }
          : null,
      });
    }

    if (!ctx.context.flyToken) {
      return NextResponse.json({ error: "fly_token_missing" }, { status: 400 });
    }
    const flyToken = ctx.context.flyToken;

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

    const ghcr = brainGhcrAuth({
      allSecrets: ctx.context.allSecrets,
      githubToken: ctx.context.githubToken,
      account: ctx.context.account,
    });
    const discoveredImages = await discoverBrainPackageImages({
      owner: ctx.context.owner,
      repo: ctx.context.repo,
      account: ctx.context.account,
      githubToken: ghcr.token,
    });
    const completedImage = discoveredImages.find(
      (image) => image.imageRef === save.expectedImageRef,
    );
    if (completedImage) {
      return NextResponse.json(
        await recordCompletedBrainImageSave({
          account: ctx.context.account,
          githubToken: ctx.context.githubToken,
          save,
          imageRef: save.expectedImageRef,
          finishedAt: completedImage.updatedAt,
        }),
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
      orgSlug: save.orgSlug,
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
    const progress = brainImageSaveProgressFromOutput(job);

    if (job.status === "running") {
      const updatedSave: BrainImageSaveFile = {
        ...save,
        phase: progress.phase,
        message: progress.message,
        lastOutput: progress.lastOutput,
        updatedAt: new Date().toISOString(),
      };
      if (
        save.phase !== updatedSave.phase ||
        save.message !== updatedSave.message ||
        save.lastOutput !== updatedSave.lastOutput
      ) {
        await writeBrainImageSave(
          ctx.context.account,
          ctx.context.githubToken,
          updatedSave,
        );
      }
      return NextResponse.json(savePollResponse(updatedSave, job));
    }

    if (job.status === "failed") {
      const failed: BrainImageSaveFile = {
        ...save,
        status: "failed",
        phase: "failed",
        message: progress.message,
        lastOutput: progress.lastOutput,
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
          phase: "failed",
          jobId: save.jobId,
          message: failed.error,
          lastOutput: progress.lastOutput,
        },
        { status: 500 },
      );
    }

    const imageRef = imageRefFromJob(job);
    if (imageRef !== save.expectedImageRef) {
      throw new Error("Brain image build returned an unexpected image ref");
    }
    return NextResponse.json(
      await recordCompletedBrainImageSave({
        account: ctx.context.account,
        githubToken: ctx.context.githubToken,
        save,
        imageRef,
        finishedAt: job.finishedAt,
        lastOutput: progress.lastOutput,
      }),
    );
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

export async function PATCH(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  setGitHubContext(
    ctx.context.owner,
    ctx.context.repo,
    ctx.context.githubToken,
    ctx.context.storeRepoUrl,
    ctx.context.storeRef,
  );

  try {
    const body = (await req.json().catch(() => ({}))) as { imageRef?: string };
    if (!body.imageRef) {
      return NextResponse.json(
        { error: "image_ref_required", message: "Image ref is required." },
        { status: 400 },
      );
    }
    let image = await readBrainImage(
      ctx.context.account,
      ctx.context.githubToken,
    );
    let requestedImage = image?.images.find(
      (saved) => saved.imageRef === body.imageRef,
    );
    if (!requestedImage) {
      const ghcr = brainGhcrAuth({
        allSecrets: ctx.context.allSecrets,
        githubToken: ctx.context.githubToken,
        account: ctx.context.account,
      });
      const discoveredImages = await discoverBrainPackageImages({
        owner: ctx.context.owner,
        repo: ctx.context.repo,
        account: ctx.context.account,
        githubToken: ghcr.token,
      });
      const images = mergeBrainSavedImages(image, discoveredImages);
      requestedImage = images.find(
        (image) => image.imageRef === body.imageRef,
      );
      if (requestedImage) {
        const now = new Date().toISOString();
        image = brainImageCatalogFile({
          previous: image,
          createdAt: requestedImage.createdAt,
          updatedAt: now,
          images,
        });
        await writeBrainImage(
          ctx.context.account,
          ctx.context.githubToken,
          image,
        );
      }
    }
    if (!requestedImage) {
      return NextResponse.json(
        {
          error: "brain_image_not_saved",
          message: image ? "Brain image is not saved" : "No Brain images saved",
        },
        { status: 400 },
      );
    }
    await selectBrainRuntimeImage(
      ctx.context.account,
      ctx.context.githubToken,
      body.imageRef,
    );
    const runtime = await readBrainRuntimeView(
      ctx.context.account,
      ctx.context.githubToken,
    );
    return NextResponse.json(imageManagementResponse(image, runtime));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "brain_image_select_failed", message },
      { status: 400 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const imageRef = req.nextUrl.searchParams.get("imageRef")?.trim();
  if (!imageRef) {
    return NextResponse.json(
      { error: "image_ref_required", message: "Image ref is required." },
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
    const image = await deleteBrainImage(
      ctx.context.account,
      ctx.context.githubToken,
      imageRef,
    );
    const runtime = await readBrainRuntimeView(
      ctx.context.account,
      ctx.context.githubToken,
    );
    return NextResponse.json(imageManagementResponse(image, runtime));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "brain_image_delete_failed", message },
      { status: 400 },
    );
  } finally {
    clearGitHubContext();
  }
}
