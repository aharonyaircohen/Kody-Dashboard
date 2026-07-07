/**
 * @fileType use-case
 * @domain brain
 * @pattern brain-image-management
 *
 * Query and command boundary for saved Brain image state. Routes translate HTTP;
 * this layer owns catalog, save polling, selection, and deletion behavior.
 */
import "server-only";

import type { FlyContext } from "@dashboard/lib/runners/fly-context";
import {
  getTerminalBridgeExecJob,
  type TerminalBridgeExecJob,
} from "@dashboard/lib/terminal/bridge-exec-client";
import { ensureTerminalBridge } from "@dashboard/lib/terminal/bridge-fly";
import { mintTerminalBridgeToken } from "@dashboard/lib/terminal/terminal-token";

import {
  brainImageCatalogFile,
  discoverBrainPackageImages,
  mergeBrainSavedImages,
  upsertBrainCatalogImageFile,
} from "./image-catalog";
import { brainGhcrAuth } from "./image-runtime";
import { brainImageSaveProgressFromOutput } from "./image-save";
import { brainImageJobTimeoutMs } from "./image-timeouts";
import {
  readBrainRuntimeView,
  selectBrainRuntimeImage,
} from "./runtime-manager";
import {
  readBrainRuntimeAuthority,
  type BrainRuntimeDrift,
} from "./runtime-authority";
import { resolveBrainService } from "./service-resolver";
import {
  clearBrainImageSave,
  deleteBrainImage,
  readBrainImage,
  readBrainImageSave,
  writeBrainImage,
  writeBrainImageSave,
  type BrainImageSaveFile,
  type BrainSavedImage,
} from "./store";

export class BrainImageManagementError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "brain_image_management_failed",
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

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
    heartbeatAt: progress.heartbeatAt,
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

async function discoverImages(
  context: FlyContext,
  options: { refresh?: boolean; scope?: string } = {},
): Promise<BrainSavedImage[]> {
  const ghcr = brainGhcrAuth({
    allSecrets: context.allSecrets,
    githubToken: context.githubToken,
    account: context.account,
  });
  return discoverBrainPackageImages(
    {
      owner: context.owner,
      repo: context.repo,
      account: context.account,
      githubToken: ghcr.token,
    },
    options,
  );
}

function formatBrainImageSaveTimeout(timeoutMs: number): string {
  const minutes = Math.floor(timeoutMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${minutes}m`;
}

function staleRunningSaveFailure(
  save: BrainImageSaveFile,
  now = Date.now(),
): BrainImageSaveFile | null {
  if (save.status !== "running") return null;
  const reference = Date.parse(
    save.heartbeatAt || save.updatedAt || save.startedAt,
  );
  if (!Number.isFinite(reference)) return null;
  const timeoutMs = brainImageJobTimeoutMs();
  if (now - reference <= timeoutMs) return null;
  const elapsed = formatBrainImageSaveTimeout(timeoutMs);
  return {
    ...save,
    status: "failed",
    phase: "failed",
    message: "Brain image save timed out",
    updatedAt: new Date(now).toISOString(),
    error: `Brain image save timed out after ${elapsed} without progress.`,
  };
}

async function reconcileBrainImageSaveForManagement(input: {
  account: string;
  githubToken: string;
  save: BrainImageSaveFile | null;
}): Promise<BrainImageSaveFile | null> {
  const failed = input.save ? staleRunningSaveFailure(input.save) : null;
  if (!failed) return input.save;
  await writeBrainImageSave(input.account, input.githubToken, failed);
  return failed;
}

async function findCompletedBrainImageSave(
  context: FlyContext,
  save: BrainImageSaveFile,
): Promise<BrainSavedImage | null> {
  const images = await discoverImages(context, {
    refresh: true,
    scope: save.expectedImageRef,
  });
  return (
    images.find((image) => image.imageRef === save.expectedImageRef) ?? null
  );
}

async function recordCompletedBrainImageSave(input: {
  account: string;
  githubToken: string;
  save: BrainImageSaveFile;
  imageRef: string;
  finishedAt?: string | null;
  lastOutput?: string;
}) {
  const previous = await readBrainImage(input.account, input.githubToken).catch(
    () => null,
  );
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

export async function readBrainImageManagement(input: { context: FlyContext }) {
  const { context } = input;
  const image = await readBrainImage(context.account, context.githubToken);
  const discoveredImages = await discoverImages(context);
  const save = await reconcileBrainImageSaveForManagement({
    account: context.account,
    githubToken: context.githubToken,
    save: await readBrainImageSave(context.account, context.githubToken),
  });
  const authority = await readBrainRuntimeAuthority({
    flyToken: context.flyToken,
    account: context.account,
    githubToken: context.githubToken,
    orgSlug: context.flyOrgSlug,
    defaultRegion: context.flyDefaultRegion,
    allowServiceFailure: true,
  });
  return {
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
          heartbeatAt: save.heartbeatAt,
          lastOutput: save.lastOutput,
          jobId: save.jobId,
          imageRef: save.expectedImageRef,
          startedAt: save.startedAt,
          updatedAt: save.updatedAt,
          error: save.error,
        }
      : null,
  };
}

export async function pollBrainImageSave(input: {
  context: FlyContext;
  jobId: string;
}) {
  const { context, jobId } = input;
  if (!context.flyToken) {
    throw new BrainImageManagementError(
      "fly_token_missing",
      400,
      "fly_token_missing",
    );
  }

  const save = await readBrainImageSave(context.account, context.githubToken);
  if (!save) {
    return { ok: true, status: "idle" as const };
  }
  if (save.jobId !== jobId) {
    throw new BrainImageManagementError(
      "Brain image save job not found.",
      404,
      "job_not_found",
    );
  }

  const completedImage = await findCompletedBrainImageSave(context, save);
  if (completedImage) {
    return recordCompletedBrainImageSave({
      account: context.account,
      githubToken: context.githubToken,
      save,
      imageRef: save.expectedImageRef,
      finishedAt: completedImage.updatedAt,
    });
  }

  const service = await resolveBrainService({
    flyToken: context.flyToken,
    account: context.account,
    githubToken: context.githubToken,
    orgSlug: save.orgSlug,
    defaultRegion: save.defaultRegion,
    appNameOverride: save.app,
    machineIdOverride: save.machineId,
  });
  if (service.reason === "fly_access_denied") {
    throw new BrainImageManagementError(
      "Fly token cannot access this Brain app.",
      403,
      "fly_access_denied",
      {
        app: service.app,
        org: service.orgSlug,
      },
    );
  }
  const operationFlyToken = service.flyToken;
  const operationOrgSlug = service.orgSlug;

  const bridge = await ensureTerminalBridge({
    token: operationFlyToken,
    orgSlug: operationOrgSlug,
    defaultRegion: save.defaultRegion,
  });
  const token = mintTerminalBridgeToken({
    owner: context.owner,
    repo: context.repo,
    app: save.app,
    orgSlug: operationOrgSlug,
    flyToken: operationFlyToken,
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
      heartbeatAt: progress.heartbeatAt,
      lastOutput: progress.lastOutput,
      updatedAt: new Date().toISOString(),
    };
    if (
      save.phase !== updatedSave.phase ||
      save.message !== updatedSave.message ||
      save.heartbeatAt !== updatedSave.heartbeatAt ||
      save.lastOutput !== updatedSave.lastOutput
    ) {
      await writeBrainImageSave(
        context.account,
        context.githubToken,
        updatedSave,
      );
    }
    return savePollResponse(updatedSave, job);
  }

  if (job.status === "failed") {
    const completedImageAfterFailure = await findCompletedBrainImageSave(
      context,
      save,
    );
    if (completedImageAfterFailure) {
      return recordCompletedBrainImageSave({
        account: context.account,
        githubToken: context.githubToken,
        save,
        imageRef: save.expectedImageRef,
        finishedAt: completedImageAfterFailure.updatedAt,
        lastOutput: progress.lastOutput,
      });
    }

    const failed: BrainImageSaveFile = {
      ...save,
      status: "failed",
      phase: "failed",
      message: progress.message,
      lastOutput: progress.lastOutput,
      updatedAt: new Date().toISOString(),
      error: jobMessage(job),
    };
    await writeBrainImageSave(context.account, context.githubToken, failed);
    throw new BrainImageManagementError(
      failed.error ?? "Brain image save failed",
      500,
      "brain_image_save_failed",
      {
        jobId: save.jobId,
        lastOutput: progress.lastOutput,
      },
    );
  }

  const imageRef = imageRefFromJob(job);
  if (imageRef !== save.expectedImageRef) {
    throw new Error("Brain image build returned an unexpected image ref");
  }
  return recordCompletedBrainImageSave({
    account: context.account,
    githubToken: context.githubToken,
    save,
    imageRef,
    finishedAt: job.finishedAt,
    lastOutput: progress.lastOutput,
  });
}

export async function selectBrainImageRef(input: {
  context: FlyContext;
  imageRef: string;
}) {
  const { context, imageRef } = input;
  let image = await readBrainImage(context.account, context.githubToken);
  let requestedImage = image?.images.find(
    (saved) => saved.imageRef === imageRef,
  );
  if (!requestedImage) {
    const images = mergeBrainSavedImages(image, await discoverImages(context));
    requestedImage = images.find((image) => image.imageRef === imageRef);
    if (requestedImage) {
      const now = new Date().toISOString();
      image = brainImageCatalogFile({
        previous: image,
        createdAt: requestedImage.createdAt,
        updatedAt: now,
        images,
      });
      await writeBrainImage(context.account, context.githubToken, image);
    }
  }
  if (!requestedImage) {
    throw new BrainImageManagementError(
      image ? "Brain image is not saved" : "No Brain images saved",
      400,
      "brain_image_not_saved",
    );
  }
  await selectBrainRuntimeImage(context.account, context.githubToken, imageRef);
  const runtime = await readBrainRuntimeView(
    context.account,
    context.githubToken,
  );
  return imageManagementResponse(image, runtime);
}

export async function forgetBrainImageRef(input: {
  context: FlyContext;
  imageRef: string;
}) {
  const { context, imageRef } = input;
  const image = await deleteBrainImage(
    context.account,
    context.githubToken,
    imageRef,
  );
  const runtime = await readBrainRuntimeView(
    context.account,
    context.githubToken,
  );
  return imageManagementResponse(image, runtime);
}
