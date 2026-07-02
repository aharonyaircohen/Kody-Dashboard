/**
 * @fileType service
 * @domain brain
 * @pattern brain-image-apply
 *
 * @ai-summary Applies the selected saved Brain image to the user's Fly
 *   Brain: select image, provision/replace machine, copy image into the
 *   per-app Fly registry, write app record. Deliberately split from
 *   terminal-session start so connecting to a terminal never mutates Brain
 *   infrastructure (terminal code never imports this module — only the
 *   `/api/kody/chat/brain` apply route does). Trap: `writeBrainApp` is
 *   best-effort (a failed metadata write is logged but does not fail the
 *   apply), while the actual `provisionBrain` machine create is fatal —
 *   the UI tolerates stale app metadata but a half-built machine would be
 *   the orphan case from `store.ts`. Do not promote the metadata write to
 *   fatal without also revisiting the Runner page's "we think you have an
 *   app, terminate it" recovery flow.
 */
import "server-only";

import {
  brainFlyRuntimeImageRef,
  brainGhcrAuth,
  prepareBrainRuntimeImage,
} from "@dashboard/lib/brain/image-runtime";
import {
  readBrainApp,
  readBrainImage,
  selectBrainImage,
  writeBrainApp,
  type BrainImageFile,
} from "@dashboard/lib/brain/store";
import {
  beginBrainRuntimeApply,
  completeBrainRuntimeApply,
  failBrainRuntimeApply,
} from "@dashboard/lib/brain/runtime-manager";
import type { BrainRuntimeStateFile } from "@dashboard/lib/brain/runtime-store";
import { resolveBrainTarget } from "@dashboard/lib/brain/target";
import { logger } from "@dashboard/lib/logger";
import {
  provisionBrain,
  type PerfTier,
  type ProvisionBrainResult,
} from "@dashboard/lib/runners/brain-fly";
import type { EngineRuntimeModelConfig } from "@dashboard/lib/variables/models";

export interface ApplyBrainImageInput {
  owner: string;
  repo: string;
  account: string;
  githubToken: string;
  allSecrets: Record<string, string>;
  flyToken: string;
  flyOrgSlug: string;
  flyDefaultRegion: string;
  dashboardUrl: string;
  engineModel?: string;
  engineModelConfig?: EngineRuntimeModelConfig;
  perfTier?: PerfTier;
  imageRef?: string;
}

export interface ApplyBrainImageResult {
  image: BrainImageFile;
  brain: ProvisionBrainResult;
  runtime: BrainRuntimeStateFile;
}

export async function applySelectedBrainImage(
  input: ApplyBrainImageInput,
): Promise<ApplyBrainImageResult> {
  const image = await readBrainImage(input.account, input.githubToken);
  if (!image) {
    throw new Error("No Brain images saved");
  }
  const imageRef = input.imageRef ?? image.imageRef;
  if (!imageRef) {
    throw new Error("No Brain image selected");
  }
  const savedImage = image.images.find((saved) => saved.imageRef === imageRef);
  if (!savedImage) {
    throw new Error("Brain image is not saved");
  }

  await beginBrainRuntimeApply(input.account, input.githubToken, imageRef);

  try {
    const stored = await readBrainApp(input.account, input.githubToken).catch(
      () => null,
    );
    const target = resolveBrainTarget({
      account: input.account,
      contextOrgSlug: input.flyOrgSlug,
      stored,
    });
    const ghcr = brainGhcrAuth({
      allSecrets: input.allSecrets,
      githubToken: input.githubToken,
      account: input.account,
    });

    const brain = await provisionBrain({
      flyToken: input.flyToken,
      account: input.account,
      model: input.engineModel,
      modelConfig: input.engineModelConfig,
      githubToken: input.githubToken,
      allSecrets: input.allSecrets,
      perfTier: input.perfTier,
      orgSlug: target.orgSlug,
      defaultRegion: input.flyDefaultRegion,
      dashboardUrl: input.dashboardUrl,
      appNameOverride: target.app,
      imageRef,
      resolveRuntimeImageRef: ({ app, imageRef }) =>
        Promise.resolve(brainFlyRuntimeImageRef({ app, imageRef })),
      prepareRuntimeImage: async ({ app, sourceImageRef, runtimeImageRef }) => {
        await prepareBrainRuntimeImage({
          owner: input.owner,
          repo: input.repo,
          app,
          imageRef: sourceImageRef,
          runtimeImageRef,
          flyToken: input.flyToken,
          ghcrToken: ghcr.token,
          ghcrUser: ghcr.user,
          orgSlug: target.orgSlug,
          defaultRegion: input.flyDefaultRegion,
        });
      },
    });

    await writeBrainApp(input.account, input.githubToken, {
      version: 1,
      appName: brain.app,
      orgSlug: brain.org,
      createdAt: new Date().toISOString(),
    }).catch((err) => {
      logger.warn(
        { err, owner: input.owner, app: brain.app },
        "brain image apply: record app write failed",
      );
    });

    const selectedImage = await selectBrainImage(
      input.account,
      input.githubToken,
      imageRef,
    );
    const runtime = await completeBrainRuntimeApply(
      input.account,
      input.githubToken,
      {
        imageRef,
        app: brain.app,
        machineId: brain.machineId,
        orgSlug: brain.org,
        url: brain.url,
      },
    );

    return { image: selectedImage, brain, runtime };
  } catch (err) {
    await failBrainRuntimeApply(
      input.account,
      input.githubToken,
      imageRef,
      err instanceof Error ? err.message : String(err),
    ).catch((writeErr) => {
      logger.warn(
        { err: writeErr, owner: input.owner, imageRef },
        "brain image apply: failure state write failed",
      );
    });
    throw err;
  }
}
