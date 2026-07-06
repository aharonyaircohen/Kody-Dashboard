/**
 * @fileType service
 * @domain brain
 * @pattern brain-image-apply
 *
 * Applies the selected Brain image to the user's Fly Brain. This is separate
 * from terminal session start so connecting to a terminal never mutates Brain
 * infrastructure.
 */
import "server-only";

import {
  brainFlyRuntimeImageRef,
  brainGhcrAuth,
  prepareBrainRuntimeImage,
} from "@dashboard/lib/brain/image-runtime";
import {
  brainImageCatalogFile,
  discoverBrainPackageImages,
  mergeBrainSavedImages,
} from "@dashboard/lib/brain/image-catalog";
import {
  readBrainApp,
  readBrainImage,
  writeBrainImage,
  writeBrainApp,
  type BrainImageFile,
} from "@dashboard/lib/brain/store";
import { resolveBrainService } from "@dashboard/lib/brain/service-resolver";
import {
  beginBrainRuntimeApply,
  completeBrainRuntimeApply,
  failBrainRuntimeApply,
  readBrainRuntimeView,
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
  let image = await readBrainImage(input.account, input.githubToken);
  const runtimeView = await readBrainRuntimeView(
    input.account,
    input.githubToken,
  );
  const imageRef =
    input.imageRef ?? runtimeView.desiredImageRef ?? image?.imageRef;
  if (!imageRef) {
    throw new Error("No Brain image selected");
  }
  const ghcr = brainGhcrAuth({
    allSecrets: input.allSecrets,
    githubToken: input.githubToken,
    account: input.account,
  });
  let savedImage = image?.images.find((saved) => saved.imageRef === imageRef);
  if (!savedImage) {
    const discoveredImages = await discoverBrainPackageImages({
      owner: input.owner,
      repo: input.repo,
      account: input.account,
      githubToken: ghcr.token,
    });
    const images = mergeBrainSavedImages(image, discoveredImages);
    savedImage = images.find((saved) => saved.imageRef === imageRef);
    if (savedImage) {
      const now = new Date().toISOString();
      image = brainImageCatalogFile({
        previous: image,
        createdAt: image?.createdAt ?? savedImage.createdAt,
        updatedAt: now,
        images,
      });
      await writeBrainImage(input.account, input.githubToken, image);
    }
  }
  if (!savedImage) {
    throw new Error(
      image ? "Brain image is not saved" : "No Brain images saved",
    );
  }
  const catalogImage = image;
  if (!catalogImage) {
    throw new Error("No Brain images saved");
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
    const service = await resolveBrainService({
      flyToken: input.flyToken,
      account: input.account,
      githubToken: input.githubToken,
      orgSlug: input.flyOrgSlug,
      defaultRegion: input.flyDefaultRegion,
      appNameOverride: target.app,
    });
    if (service.reason === "fly_access_denied") {
      throw new Error("Fly token cannot access this Brain app.");
    }
    const operationFlyToken = service.flyToken;
    const operationOrgSlug = service.orgSlug;
    const brain = await provisionBrain({
      flyToken: operationFlyToken,
      account: input.account,
      model: input.engineModel,
      modelConfig: input.engineModelConfig,
      githubToken: input.githubToken,
      allSecrets: input.allSecrets,
      perfTier: input.perfTier,
      orgSlug: operationOrgSlug,
      defaultRegion: input.flyDefaultRegion,
      dashboardUrl: input.dashboardUrl,
      appNameOverride: service.app,
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
          flyToken: operationFlyToken,
          ghcrToken: ghcr.token,
          ghcrUser: ghcr.user,
          orgSlug: operationOrgSlug,
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

    return { image: catalogImage, brain, runtime };
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
