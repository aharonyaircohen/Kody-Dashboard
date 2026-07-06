/**
 * @fileType service
 * @domain brain
 * @pattern brain-runtime-authority
 *
 * Single read model for Brain runtime truth. UI routes may present this state,
 * but they should not independently decide whether the selected image, running
 * machine, and Fly machine image agree.
 */
import "server-only";

import { readBrainRuntimeView, type BrainRuntimeView } from "./runtime-manager";
import {
  resolveBrainService,
  type BrainServiceResolution,
} from "./service-resolver";

export type BrainRuntimeDriftCode =
  | "completed_apply_missing_running"
  | "selected_image_not_running"
  | "machine_image_unknown"
  | "machine_image_mismatch";

export interface BrainRuntimeDrift {
  code: BrainRuntimeDriftCode;
  message: string;
  desiredImageRef?: string;
  runningImageRef?: string | null;
  machineImageRef?: string | null;
}

export interface BrainRuntimeAuthorityView {
  runtime: BrainRuntimeView;
  service: BrainServiceResolution | null;
  drift: BrainRuntimeDrift | null;
}

export interface BrainRuntimeAuthorityInput {
  flyToken?: string | null;
  account: string;
  githubToken: string;
  orgSlug: string;
  defaultRegion: string;
  allowServiceFailure?: boolean;
}

function imageTag(imageRef: string): string {
  const withoutDigest = imageRef.split("@")[0] ?? imageRef;
  const marker = withoutDigest.lastIndexOf(":");
  return marker === -1 ? imageRef : withoutDigest.slice(marker + 1);
}

function sameSavedImageTag(a: string, b: string): boolean {
  return imageTag(a) === imageTag(b);
}

export function brainRuntimeDrift(
  runtime: BrainRuntimeView,
  machine: { imageRef?: string | null; state?: string | null } | null,
): BrainRuntimeDrift | null {
  const desiredImageRef = runtime.desiredImageRef;
  const runningImageRef = runtime.runningImageRef ?? null;
  if (
    runtime.operation?.type === "apply-image" &&
    runtime.operation.status === "completed" &&
    runtime.operation.imageRef === desiredImageRef &&
    !runningImageRef
  ) {
    return {
      code: "completed_apply_missing_running",
      message: "Brain image apply completed, but no running machine is recorded.",
      desiredImageRef,
      runningImageRef,
      machineImageRef: machine?.imageRef ?? null,
    };
  }

  if (desiredImageRef && desiredImageRef !== runningImageRef) {
    return {
      code: "selected_image_not_running",
      message: "Selected Brain image is not running.",
      desiredImageRef,
      runningImageRef,
      machineImageRef: machine?.imageRef ?? null,
    };
  }

  if (runningImageRef && !machine?.imageRef) {
    return {
      code: "machine_image_unknown",
      message: "Running Brain image is recorded, but the live machine image is unknown.",
      desiredImageRef,
      runningImageRef,
      machineImageRef: null,
    };
  }

  if (
    runningImageRef &&
    machine?.imageRef &&
    !sameSavedImageTag(runningImageRef, machine.imageRef)
  ) {
    return {
      code: "machine_image_mismatch",
      message: "Running Brain image does not match the live Fly machine image.",
      desiredImageRef,
      runningImageRef,
      machineImageRef: machine.imageRef,
    };
  }

  return null;
}

export async function readBrainRuntimeAuthority(
  input: BrainRuntimeAuthorityInput,
): Promise<BrainRuntimeAuthorityView> {
  const runtime = await readBrainRuntimeView(input.account, input.githubToken);
  let service: BrainServiceResolution | null = null;
  if (input.flyToken) {
    const readService = resolveBrainService({
      flyToken: input.flyToken,
      account: input.account,
      githubToken: input.githubToken,
      orgSlug: input.orgSlug,
      defaultRegion: input.defaultRegion,
    });
    service = input.allowServiceFailure
      ? await readService.catch(() => null)
      : await readService;
  }
  return {
    runtime,
    service,
    drift: brainRuntimeDrift(
      runtime,
      service
        ? {
            imageRef: service.machineImageRef,
            state: service.state,
          }
        : null,
    ),
  };
}
