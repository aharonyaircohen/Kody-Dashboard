/**
 * @fileType use-case
 * @domain brain
 * @pattern brain-image-save-command
 *
 * Command boundary for saving the current live Brain server as a GHCR image.
 */
import "server-only";

import {
  startTerminalBridgeLocalExecJob,
} from "@dashboard/lib/terminal/bridge-exec-client";
import { ensureTerminalBridge } from "@dashboard/lib/terminal/bridge-fly";
import { mintTerminalBridgeToken } from "@dashboard/lib/terminal/terminal-token";
import { DEFAULT_IMAGE, waitForBrainHealth } from "@dashboard/lib/runners/brain-fly";
import type { FlyContext } from "@dashboard/lib/runners/fly-context";

import {
  brainGhcrImageRef,
  brainImageBuildCommand,
  brainImageTag,
} from "./image-save";
import { brainImageJobTimeoutMs } from "./image-timeouts";
import { brainGhcrAuth } from "./image-runtime";
import { resolveBrainService } from "./service-resolver";
import {
  writeBrainImageSave,
  type BrainImageSaveFile,
} from "./store";

const BRAIN_IMAGE_JOB_OUTPUT_BYTES = 2_000_000;

export interface StartBrainImageSaveInput {
  context: FlyContext;
}

export async function startBrainImageSave(input: StartBrainImageSaveInput) {
  const { context } = input;
  if (!context.flyToken) {
    throw new Error(
      "Brain image save needs a Fly Machines token. Add FLY_API_TOKEN to the repo Secrets vault.",
    );
  }

  const brain = await resolveBrainService({
    flyToken: context.flyToken,
    account: context.account,
    githubToken: context.githubToken,
    orgSlug: context.flyOrgSlug,
    defaultRegion: context.flyDefaultRegion,
  });
  const app = brain.app;
  const machineId = brain.machineId;
  const brainFlyToken = brain.flyToken;
  if (brain.reason === "fly_access_denied") {
    const error = new Error("Fly token cannot access this Brain app.") as Error & {
      status?: number;
      code?: string;
      app?: string;
      org?: string;
    };
    error.status = 403;
    error.code = "fly_access_denied";
    error.app = brain.app;
    error.org = brain.orgSlug;
    throw error;
  }
  if (brain.state === "off" || !machineId || !brain.url) {
    const error = new Error("No Brain machine found to save.") as Error & {
      status?: number;
      code?: string;
      reason?: string;
    };
    error.status = 404;
    error.code = "brain_not_found";
    error.reason = brain.reason;
    throw error;
  }
  await waitForBrainHealth(brain.url, 120_000);

  const bridge = await ensureTerminalBridge({
    token: brainFlyToken,
    orgSlug: brain.orgSlug,
    defaultRegion: brain.defaultRegion,
  });
  const ghcr = brainGhcrAuth({
    allSecrets: context.allSecrets,
    githubToken: context.githubToken,
    account: context.account,
  });
  const token = mintTerminalBridgeToken({
    owner: context.owner,
    repo: context.repo,
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
    owner: context.owner,
    account: context.account,
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
  await writeBrainImageSave(context.account, context.githubToken, save);

  return {
    ok: true,
    status: "running" as const,
    phase: "starting" as const,
    message: "Starting Brain image save",
    jobId: job.id,
    app,
    machineId,
    imageRef: expectedImageRef,
    startedAt: save.startedAt,
  };
}
