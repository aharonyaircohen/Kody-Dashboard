/**
 * @fileType service
 * @domain brain
 * @pattern brain-runtime-manager
 *
 * @ai-summary Owns Brain desired↔running state transitions. The view
 *   merges the new per-user runtime state file (`runtime-store.ts`,
 *   `BrainRuntimeStateFile`) with legacy fields still living on the saved
 *   image catalog (`BrainImageFile.runningImageRef` and friends), so
 *   callers see a single `BrainRuntimeView` regardless of which shape a
 *   given user is on. Trap: `source: "runtime" | "legacy" | "empty"` on
 *   the view tells callers which shape they got — don't assume
 *   `runningImageRef` is always present (legacy) or always nested under
 *   `running.imageRef` (new). When you add a new field, add it to both
 *   shapes and pick the truth by `source`. API routes and terminal
 *   session code should depend on this layer instead of reading image
 *   catalog internals — it is the only path that survives the
 *   new↔legacy migration.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { readBrainImage } from "./store";
import {
  readBrainRuntimeState,
  writeBrainRuntimeState,
  type BrainRuntimeOperation,
  type BrainRuntimeRunning,
  type BrainRuntimeStateFile,
} from "./runtime-store";

export interface BrainRuntimeView {
  desiredImageRef?: string;
  runningImageRef?: string;
  runningAt?: string;
  runningApp?: string;
  runningMachineId?: string;
  runningOrgSlug?: string;
  runningUrl?: string;
  operation?: BrainRuntimeOperation;
  source: "runtime" | "legacy" | "empty";
}

export async function readBrainRuntimeView(
  login: string,
  token: string,
): Promise<BrainRuntimeView> {
  const runtime = await readBrainRuntimeState(login, token);
  if (runtime?.running) {
    return viewFromRuntime(runtime);
  }
  const legacyImage = await readBrainImage(login, token).catch(() => null);
  if (legacyImage?.runningImageRef) {
    return {
      desiredImageRef: runtime?.desiredImageRef ?? legacyImage.imageRef,
      runningImageRef: legacyImage.runningImageRef,
      runningAt: legacyImage.runningAt,
      runningApp: legacyImage.runningApp,
      runningMachineId: legacyImage.runningMachineId,
      operation: runtime?.operation,
      source: "legacy",
    };
  }
  return {
    desiredImageRef: runtime?.desiredImageRef ?? legacyImage?.imageRef,
    operation: runtime?.operation,
    source: runtime ? "runtime" : "empty",
  };
}

function viewFromRuntime(runtime: BrainRuntimeStateFile): BrainRuntimeView {
  const running = runtime.running;
  return {
    desiredImageRef: runtime.desiredImageRef,
    ...(running
      ? {
          runningImageRef: running.imageRef,
          runningAt: running.appliedAt,
          runningApp: running.app,
          runningMachineId: running.machineId,
          runningOrgSlug: running.orgSlug,
          runningUrl: running.url,
        }
      : {}),
    operation: runtime.operation,
    source: "runtime",
  };
}

export async function selectBrainRuntimeImage(
  login: string,
  token: string,
  imageRef: string,
): Promise<BrainRuntimeStateFile> {
  const now = new Date().toISOString();
  const current = await readBrainRuntimeState(login, token);
  const next: BrainRuntimeStateFile = {
    version: 1,
    desiredImageRef: imageRef,
    ...(current?.running ? { running: current.running } : {}),
    ...(current?.operation ? { operation: current.operation } : {}),
    updatedAt: now,
  };
  await writeBrainRuntimeState(login, token, next);
  return next;
}

export async function beginBrainRuntimeApply(
  login: string,
  token: string,
  imageRef: string,
): Promise<BrainRuntimeStateFile> {
  const now = new Date().toISOString();
  const current = await readBrainRuntimeState(login, token);
  const operation: BrainRuntimeOperation = {
    id: randomUUID().replaceAll("-", ""),
    type: "apply-image",
    status: "running",
    imageRef,
    startedAt: now,
    updatedAt: now,
  };
  const next: BrainRuntimeStateFile = {
    version: 1,
    desiredImageRef: imageRef,
    ...(current?.running ? { running: current.running } : {}),
    operation,
    updatedAt: now,
  };
  await writeBrainRuntimeState(login, token, next);
  return next;
}

export async function completeBrainRuntimeApply(
  login: string,
  token: string,
  input: {
    imageRef: string;
    app: string;
    machineId: string;
    orgSlug: string;
    url?: string;
    appliedAt?: string;
  },
): Promise<BrainRuntimeStateFile> {
  const now = input.appliedAt ?? new Date().toISOString();
  const current = await readBrainRuntimeState(login, token);
  const running: BrainRuntimeRunning = {
    imageRef: input.imageRef,
    app: input.app,
    machineId: input.machineId,
    orgSlug: input.orgSlug,
    ...(input.url ? { url: input.url } : {}),
    appliedAt: now,
  };
  const operation: BrainRuntimeOperation = {
    id: current?.operation?.id ?? randomUUID().replaceAll("-", ""),
    type: "apply-image",
    status: "completed",
    imageRef: input.imageRef,
    startedAt: current?.operation?.startedAt ?? now,
    updatedAt: now,
  };
  const next: BrainRuntimeStateFile = {
    version: 1,
    desiredImageRef: input.imageRef,
    running,
    operation,
    updatedAt: now,
  };
  await writeBrainRuntimeState(login, token, next);
  return next;
}

export async function failBrainRuntimeApply(
  login: string,
  token: string,
  imageRef: string,
  error: string,
): Promise<void> {
  const now = new Date().toISOString();
  const current = await readBrainRuntimeState(login, token);
  const operation: BrainRuntimeOperation = {
    id: current?.operation?.id ?? randomUUID().replaceAll("-", ""),
    type: "apply-image",
    status: "failed",
    imageRef,
    startedAt: current?.operation?.startedAt ?? now,
    updatedAt: now,
    error,
  };
  await writeBrainRuntimeState(login, token, {
    version: 1,
    desiredImageRef: imageRef,
    ...(current?.running ? { running: current.running } : {}),
    operation,
    updatedAt: now,
  });
}
