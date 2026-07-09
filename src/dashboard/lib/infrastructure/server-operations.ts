/**
 * @fileType library
 * @domain infrastructure
 * @pattern server-provider-operations
 * @ai-summary Provider-neutral server operations used by Dashboard runtime,
 *   Brain, terminal, inventory, and preview support code.
 */

import type { NextRequest } from "next/server";
import type { Octokit } from "@octokit/rest";

import { getServerProvider } from "@dashboard/lib/infrastructure/installed";
import type { ServerContextBase } from "@dashboard/lib/infrastructure/contracts";
import type { EngineRuntimeModelConfig } from "@dashboard/lib/variables/models";
import type { KodyRunRequest } from "@dashboard/lib/runners/run-request";
import type {
  ServerProviderFeature as ProviderFeature,
  ServerProviderInventory as ProviderInventory,
  ServerProviderMachineInfo as ProviderMachineInfo,
  ServerProviderMachineRow as ProviderMachineRow,
} from "./server-machine-model";

export type ProviderPerfTier = "low" | "medium" | "high";
export type {
  ProviderFeature,
  ProviderInventory,
  ProviderMachineInfo,
  ProviderMachineRow,
};

export interface ProviderRuntimeConfig {
  token: string;
  orgSlug: string;
  defaultRegion: string;
}

export interface ProviderContext extends ServerContextBase {
  // Provider-owned API client. Callers narrow this at their route/use-case edge.
  octokit: Octokit;
  account: string;
  githubToken: string;
  storeRepoUrl?: string;
  storeRef?: string;
  allSecrets: Record<string, string>;
  engineModel: string | undefined;
  engineModelConfig: EngineRuntimeModelConfig | undefined;
  perfTier: ProviderPerfTier | undefined;
  providerToken?: string;
  providerOrgSlug?: string;
  providerDefaultRegion?: string;
  flyToken: string | undefined;
  flyOrgSlug: string;
  flyDefaultRegion: string;
}

export interface ProviderSavedBrainService {
  brain: ProviderBrainServiceResolution;
  context: ProviderContext;
  providerToken: string;
  flyToken: string;
}

export type ProviderBrainServiceReason =
  | "not_provisioned"
  | "stored_app_not_found"
  | "app_has_no_machine"
  | "runtime_machine_not_found"
  | "machine_lookup_failed"
  | "provider_access_denied"
  | "fly_access_denied";

export interface ProviderBrainServiceResolution {
  app: string;
  orgSlug: string;
  defaultRegion: string;
  providerToken: string;
  flyToken: string;
  stored: { appName?: string } | null;
  state: ProviderBrainStatusResult["state"];
  url?: string;
  machineId?: string;
  machineImageRef?: string;
  machine?: ProviderMachineRow;
  reason?: ProviderBrainServiceReason;
}

export interface ProviderBrainStatusResult {
  app: string;
  state: "running" | "suspended" | "stopped" | "off";
  url?: string;
  machineId?: string;
  machineImageRef?: string;
  org?: string;
  accessDenied?: boolean;
}

export interface ProviderProvisionBrainInput {
  providerToken: string;
  account: string;
  repo?: string;
  githubToken: string;
  allSecrets?: Record<string, string>;
  model?: string;
  modelConfig?: EngineRuntimeModelConfig;
  perfTier?: ProviderPerfTier;
  orgSlug?: string;
  defaultRegion?: string;
  imageRef?: string;
  replaceExistingMachine?: boolean;
  resolveRuntimeImageRef?: (input: {
    app: string;
    imageRef: string;
  }) => Promise<string>;
  prepareRuntimeImage?: (input: {
    app: string;
    sourceImageRef: string;
    runtimeImageRef: string;
  }) => Promise<void>;
  suspendOnIdle?: boolean;
  ref?: string;
  dashboardUrl?: string;
  appNameOverride?: string;
  apiKeyOverride?: string;
}

export interface ProviderProvisionBrainResult {
  app: string;
  url: string;
  apiKey: string;
  machineId: string;
  region: string;
  org: string;
  originalName?: string;
}

export interface ProviderTerminalBridgeInfo {
  app: string;
  url: string;
  secret: string;
}

export interface ProviderActivitySample {
  app: string;
  machineId: string;
  state: string;
  cpuKind?: string;
  cpus?: number;
  memoryMb?: number;
}

export interface ProviderActivitySnapshot {
  ts: number;
  machines: ProviderActivitySample[];
}

export interface ProviderActivityFile {
  version: 1;
  snapshots: ProviderActivitySnapshot[];
}

export interface ProviderMachineActivity {
  app: string;
  machineId: string;
  feature: ProviderFeature;
  label: string;
  firstSeen: number;
  lastSeen: number;
  spanMs: number;
  runningMs: number;
  uptime: number;
  suspendCount: number;
  lastState: string;
  size: {
    cpuKind?: string;
    cpus?: number;
    memoryMb?: number;
  };
  estCostUsd: number;
  samples: number;
}

export interface ProviderActivitySummary {
  windowStart: string;
  windowEnd: string;
  samples: ProviderActivitySample[];
  totalEstimatedCostUsd: number;
  byFeature: Record<string, { samples: number; estimatedCostUsd: number }>;
}

export interface ProviderCreateMachineInput {
  appName: string;
  region: string;
  image: string;
  env?: Record<string, string>;
  internalPort?: number;
  memoryMb?: number;
  cpus?: number;
  cpuKind?: "shared" | "performance";
  files?: Array<{ guestPath: string; contentBase64: string }>;
  healthCheck?: boolean;
}

export interface ProviderSpawnRunnerInput {
  repo: string;
  githubToken: string;
  runRequest: KodyRunRequest;
  providerToken?: string;
  flyToken?: string;
  [key: string]: unknown;
}

export interface InfrastructureServerOperations {
  resolveContext(
    input: unknown,
  ): Promise<
    | { ok: true; context: ProviderContext }
    | { ok: false; error: string; status: number }
  >;
  configFromContext(context: ProviderContext): ProviderRuntimeConfig | null;
  listMachines(
    appName: string,
    cfg: ProviderRuntimeConfig,
  ): Promise<ProviderMachineInfo[]>;
  startMachine(
    appName: string,
    machineId: string,
    cfg: ProviderRuntimeConfig,
  ): Promise<void>;
  hostname(appName: string): string;
  listInventory(
    cfg: ProviderRuntimeConfig,
    now?: number,
  ): Promise<ProviderInventory>;
  rowsForApp(
    app: string,
    machines: ProviderMachineInfo[],
    now?: number,
    override?: {
      feature?: ProviderFeature;
      label?: string;
      orgSlug?: string;
    },
  ): ProviderMachineRow[];
  isMachineRunning(state: string): boolean;
  emptyInventory(): ProviderInventory;
  refreshInventoryCounts(inventory: ProviderInventory): ProviderInventory;
  applySavedBrainMachineToInventory(
    inventory: ProviderInventory,
    brain: ProviderBrainServiceResolution,
  ): boolean;
  resolveSavedBrainServiceForRequest(
    req: NextRequest,
    context?: ProviderContext,
  ): Promise<ProviderSavedBrainService | null>;
  brainAppName(account: string): string;
  defaultBrainImage: string;
  waitForBrainHealth(url: string, timeoutMs?: number): Promise<void>;
  isBrainProvisionTransientError(error: unknown): boolean;
  provisionBrain(
    input: ProviderProvisionBrainInput,
  ): Promise<ProviderProvisionBrainResult>;
  resumeBrain(input: Record<string, unknown>): Promise<unknown>;
  suspendBrain(input: Record<string, unknown>): Promise<unknown>;
  destroyBrain(input: Record<string, unknown>): Promise<unknown>;
  brainStatus(
    input: Record<string, unknown>,
  ): Promise<ProviderBrainStatusResult>;
  updateBrainSuspension(
    input: Record<string, unknown>,
  ): Promise<{ app: string; machineId: string; suspendOnIdle: boolean }>;
  ensureTerminalBridge(
    cfg: ProviderRuntimeConfig,
  ): Promise<ProviderTerminalBridgeInfo>;
  findTerminalBridge(
    cfg: ProviderRuntimeConfig,
  ): Promise<ProviderTerminalBridgeInfo | null>;
  computeActivity(file: ProviderActivityFile): ProviderMachineActivity[];
  readActivityFile(
    octokit: Octokit,
    owner: string,
    repo: string,
  ): Promise<ProviderActivityFile>;
  recordSnapshot(
    octokit: Octokit,
    owner: string,
    repo: string,
    snapshot: ProviderActivitySnapshot,
  ): Promise<{ recorded: boolean }>;
  snapshotFromInventory(
    inventory: ProviderInventory,
    now: number,
  ): ProviderActivitySnapshot;
  createMachine(
    input: ProviderCreateMachineInput,
    cfg: ProviderRuntimeConfig,
  ): Promise<ProviderMachineInfo>;
  createApp(appName: string, cfg: ProviderRuntimeConfig): Promise<void>;
  allocateSharedIps(appName: string, cfg: ProviderRuntimeConfig): Promise<void>;
  alignPreviewMachineSleep(
    appName: string,
    machineId: string,
    cfg: ProviderRuntimeConfig,
    options: { idleSuspend: boolean; healthCheck: boolean; memoryMb: number },
  ): Promise<{ changed: boolean; skipped?: boolean }>;
  listAppsByPrefix(
    prefix: string,
    cfg: ProviderRuntimeConfig,
  ): Promise<string[]>;
  destroyMachine(
    appName: string,
    machineId: string,
    cfg: ProviderRuntimeConfig,
  ): Promise<void>;
  suspendMachine(
    appName: string,
    machineId: string,
    cfg: ProviderRuntimeConfig,
  ): Promise<void>;
  sleepPreviewMachine(
    appName: string,
    machineId: string,
    cfg: ProviderRuntimeConfig,
    input: { state: string; memoryMb?: number },
  ): Promise<{ slept: boolean }>;
  destroyApp(appName: string, cfg: ProviderRuntimeConfig): Promise<void>;
}

function operations(): InfrastructureServerOperations {
  return getServerProvider() as unknown as InfrastructureServerOperations;
}

export async function resolveProviderContext(
  req: NextRequest,
  options?: { repoOverride?: { owner: string; repo: string } },
) {
  return operations().resolveContext({ request: req, options });
}

export function providerConfigFromContext(
  context: ProviderContext,
): ProviderRuntimeConfig | null {
  return operations().configFromContext(context);
}

export const serverOperations = {
  provider: operations,
  resolveContext: resolveProviderContext,
  configFromContext: providerConfigFromContext,
};
