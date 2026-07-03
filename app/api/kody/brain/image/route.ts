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
  clearBrainImageSave,
  deleteBrainImage,
  readBrainImage,
  readBrainImageSave,
  selectBrainImage,
  writeBrainImage,
  writeBrainImageSave,
  type BrainImageFile,
  type BrainImageSaveFile,
  type BrainSavedImage,
} from "@dashboard/lib/brain/store";
import {
  brainGhcrImageRef,
  brainImageBuildCommand,
  brainImageTag,
} from "@dashboard/lib/brain/image-save";
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

function imageManagementResponse(
  image: Awaited<ReturnType<typeof readBrainImage>>,
  runtime: Awaited<ReturnType<typeof readBrainRuntimeView>> | null,
  machine: { imageRef?: string; state?: string } | null = null,
  discoveredImages: BrainSavedImage[] = [],
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
    images,
    createdAt: image?.createdAt ?? null,
    updatedAt: image?.updatedAt ?? null,
  };
}

interface GitHubPackageVersion {
  created_at?: unknown;
  updated_at?: unknown;
  metadata?: {
    container?: {
      tags?: unknown;
    };
  };
}

const IMAGE_TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

function brainImagePackage(input: { owner: string; account: string }): {
  baseRef: string;
  packageName: string;
} {
  const ref = brainGhcrImageRef({
    owner: input.owner,
    account: input.account,
    tag: "probe",
  });
  const baseRef = ref.replace(/:probe$/, "");
  const packageName = baseRef.split("/").at(-1);
  if (!packageName) {
    throw new Error("Invalid Brain image package");
  }
  return { baseRef, packageName };
}

function packageVersionUrl(input: {
  ownerKind: "orgs" | "users";
  owner: string;
  packageName: string;
  page: number;
}): string {
  const owner = encodeURIComponent(input.owner);
  const packageName = encodeURIComponent(input.packageName);
  return `https://api.github.com/${input.ownerKind}/${owner}/packages/container/${packageName}/versions?per_page=100&page=${input.page}`;
}

function savedImagesFromPackageVersions(
  versions: GitHubPackageVersion[],
  baseRef: string,
): BrainSavedImage[] {
  const images: BrainSavedImage[] = [];
  for (const version of versions) {
    const tags = version.metadata?.container?.tags;
    if (!Array.isArray(tags)) continue;
    const createdAt =
      typeof version.created_at === "string"
        ? version.created_at
        : new Date().toISOString();
    const updatedAt =
      typeof version.updated_at === "string" ? version.updated_at : createdAt;
    for (const tag of tags) {
      if (typeof tag !== "string" || !IMAGE_TAG_RE.test(tag)) continue;
      images.push({
        imageRef: `${baseRef}:${tag}`,
        createdAt,
        updatedAt,
      });
    }
  }
  return sortBrainSavedImages(images);
}

function sortBrainSavedImages(images: BrainSavedImage[]): BrainSavedImage[] {
  return [...images].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function mergeBrainSavedImages(
  image: BrainImageFile | null,
  discoveredImages: BrainSavedImage[],
): BrainSavedImage[] {
  const merged = new Map<string, BrainSavedImage>();
  const forgotten = new Set(image?.forgottenImageRefs ?? []);
  for (const discovered of discoveredImages) {
    if (forgotten.has(discovered.imageRef)) continue;
    merged.set(discovered.imageRef, discovered);
  }
  for (const saved of image?.images ?? []) {
    if (forgotten.has(saved.imageRef)) continue;
    if (!merged.has(saved.imageRef)) {
      merged.set(saved.imageRef, saved);
    }
  }
  if (
    image?.imageRef &&
    !forgotten.has(image.imageRef) &&
    !merged.has(image.imageRef)
  ) {
    merged.set(image.imageRef, {
      imageRef: image.imageRef,
      createdAt: image.createdAt,
      updatedAt: image.updatedAt,
    });
  }
  return sortBrainSavedImages([...merged.values()]);
}

async function fetchBrainPackageImages(input: {
  owner: string;
  account: string;
  githubToken: string;
}): Promise<BrainSavedImage[]> {
  const { baseRef, packageName } = brainImagePackage(input);
  for (const ownerKind of ["orgs", "users"] as const) {
    const versions: GitHubPackageVersion[] = [];
    let page = 1;
    while (page <= 10) {
      const res = await fetch(
        packageVersionUrl({
          ownerKind,
          owner: input.owner,
          packageName,
          page,
        }),
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${input.githubToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (res.status === 404 && page === 1) {
        break;
      }
      if (!res.ok) {
        throw new Error(`GitHub package versions lookup failed: ${res.status}`);
      }
      const pageVersions = (await res.json()) as unknown;
      if (!Array.isArray(pageVersions) || pageVersions.length === 0) {
        return savedImagesFromPackageVersions(versions, baseRef);
      }
      versions.push(...(pageVersions as GitHubPackageVersion[]));
      if (pageVersions.length < 100) {
        return savedImagesFromPackageVersions(versions, baseRef);
      }
      page += 1;
    }
  }
  return [];
}

async function discoverBrainPackageImages(input: {
  owner: string;
  repo: string;
  account: string;
  githubToken: string;
}): Promise<BrainSavedImage[]> {
  try {
    return await fetchBrainPackageImages(input);
  } catch (err) {
    logger.warn(
      { err, owner: input.owner, repo: input.repo },
      "brain image GHCR history lookup failed",
    );
    return [];
  }
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
      orgSlug: brain.orgSlug,
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
      timeoutMs: brainImageJobTimeoutMs(),
      maxOutputBytes: BRAIN_IMAGE_JOB_OUTPUT_BYTES,
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
      const runtime = await readBrainRuntimeView(
        ctx.context.account,
        ctx.context.githubToken,
      );
      const service = ctx.context.flyToken
        ? await resolveBrainService({
            flyToken: ctx.context.flyToken,
            account: ctx.context.account,
            githubToken: ctx.context.githubToken,
            orgSlug: ctx.context.flyOrgSlug,
            defaultRegion: ctx.context.flyDefaultRegion,
          }).catch(() => null)
        : null;
      return NextResponse.json({
        ...imageManagementResponse(
          image,
          runtime,
          service
            ? {
                imageRef: service.machineImageRef,
                state: service.state,
              }
            : null,
          discoveredImages,
        ),
        save: save
          ? {
              status: save.status,
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
    const now = new Date().toISOString();
    await writeBrainImage(ctx.context.account, ctx.context.githubToken, {
      version: 1,
      imageRef,
      createdAt: previous?.createdAt ?? save.startedAt,
      updatedAt: now,
      images: [
        {
          imageRef,
          createdAt: save.startedAt,
          updatedAt: now,
        },
        ...(previous?.images ?? []),
      ],
      ...(previous?.forgottenImageRefs?.length
        ? { forgottenImageRefs: previous.forgottenImageRefs }
        : {}),
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
    const current = await readBrainImage(
      ctx.context.account,
      ctx.context.githubToken,
    );
    if (!current?.images.some((image) => image.imageRef === body.imageRef)) {
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
      const images = mergeBrainSavedImages(current, discoveredImages);
      const requestedImage = images.find(
        (image) => image.imageRef === body.imageRef,
      );
      if (requestedImage) {
        const now = new Date().toISOString();
        await writeBrainImage(ctx.context.account, ctx.context.githubToken, {
          version: 1,
          imageRef: current?.imageRef ?? body.imageRef,
          createdAt: current?.createdAt ?? requestedImage.createdAt,
          updatedAt: current?.updatedAt ?? now,
          images,
          ...(current?.forgottenImageRefs?.filter(
            (ref) => ref !== body.imageRef,
          ).length
            ? {
                forgottenImageRefs: current.forgottenImageRefs.filter(
                  (ref) => ref !== body.imageRef,
                ),
              }
            : {}),
        });
      }
    }
    const image = await selectBrainImage(
      ctx.context.account,
      ctx.context.githubToken,
      body.imageRef,
    );
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
