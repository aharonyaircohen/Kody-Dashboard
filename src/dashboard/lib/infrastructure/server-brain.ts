import type { NextRequest } from "next/server";

import { serverOperations } from "./server-operations";
import type {
  ProviderBrainServiceResolution,
  ProviderBrainStatusResult,
  ProviderContext,
  ProviderPerfTier,
  ProviderProvisionBrainInput,
  ProviderProvisionBrainResult,
  ProviderSavedBrainService,
} from "./server-operations";

export type ServerBrainPerfTier = ProviderPerfTier;
export type ServerBrainStatusResult = ProviderBrainStatusResult;
export type ServerBrainServiceResolution = ProviderBrainServiceResolution;
export type ProvisionServerBrainInput = ProviderProvisionBrainInput;
export type ProvisionServerBrainResult = ProviderProvisionBrainResult;
export type SavedServerBrainService = ProviderSavedBrainService;
export type SavedBrainServiceForRequest = ProviderSavedBrainService;

export function serverBrainAppName(account: string): string {
  return serverOperations.provider().brainAppName(account);
}

export const defaultServerBrainImage =
  process.env.FLY_BRAIN_IMAGE ?? "ghcr.io/aharonyaircohen/kody-brain:latest";

export function waitForServerBrainHealth(url: string, timeoutMs?: number) {
  return serverOperations.provider().waitForBrainHealth(url, timeoutMs);
}

export function isServerBrainProvisionTransientError(error: unknown): boolean {
  return serverOperations.provider().isBrainProvisionTransientError(error);
}

export function provisionServerBrain(input: ProvisionServerBrainInput) {
  return serverOperations.provider().provisionBrain(input);
}

export function resumeServerBrain(input: Record<string, unknown>) {
  return serverOperations.provider().resumeBrain(input);
}

export function suspendServerBrain(input: Record<string, unknown>) {
  return serverOperations.provider().suspendBrain(input);
}

export function destroyServerBrain(input: Record<string, unknown>) {
  return serverOperations.provider().destroyBrain(input);
}

export function serverBrainStatus(
  input: Record<string, unknown>,
): Promise<ServerBrainStatusResult> {
  return serverOperations.provider().brainStatus(input);
}

export function updateServerBrainSuspension(input: Record<string, unknown>) {
  return serverOperations.provider().updateBrainSuspension(input);
}

export function resolveSavedServerBrainServiceForRequest(
  req: NextRequest,
  context?: ProviderContext,
): Promise<SavedServerBrainService | null> {
  return serverOperations
    .provider()
    .resolveSavedBrainServiceForRequest(req, context);
}

export const resolveSavedBrainServiceForRequest =
  resolveSavedServerBrainServiceForRequest;

export function applySavedServerBrainMachineToInventory(
  inventory: Parameters<
    ReturnType<
      typeof serverOperations.provider
    >["applySavedBrainMachineToInventory"]
  >[0],
  brain: ServerBrainServiceResolution,
) {
  return serverOperations
    .provider()
    .applySavedBrainMachineToInventory(inventory, brain);
}

export const applySavedBrainMachineToInventory =
  applySavedServerBrainMachineToInventory;

export {
  emptyServerProviderInventory,
  refreshServerProviderInventoryCounts,
} from "./server-machines";

export async function appendSavedBrainMachineToInventory(
  req: NextRequest,
  inventory: Parameters<
    ReturnType<
      typeof serverOperations.provider
    >["applySavedBrainMachineToInventory"]
  >[0],
  context?: ProviderContext,
): Promise<boolean> {
  const saved = await resolveSavedServerBrainServiceForRequest(req, context);
  if (!saved) return false;
  return serverOperations
    .provider()
    .applySavedBrainMachineToInventory(inventory, saved.brain);
}

export function listServerProviderInventoryCached(
  cfg: Parameters<
    ReturnType<typeof serverOperations.provider>["listInventory"]
  >[0],
) {
  return serverOperations.provider().listInventory(cfg);
}
