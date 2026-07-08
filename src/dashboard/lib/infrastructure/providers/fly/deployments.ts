/**
 * @fileType library
 * @domain infrastructure
 * @pattern fly-deployment-provider
 * @ai-summary Fly adapter for Kody deployments. PR/branch previews are modeled
 *   as deployments; Fly app/machine details stay behind this provider.
 */

import type { DeploymentProvider } from "@dashboard/lib/infrastructure/contracts";
import { logger } from "@dashboard/lib/logger";
import {
  getPreviewBuilderStatus,
  spawnPreviewBuilder,
  type SpawnBuilderResult,
} from "@dashboard/lib/previews/builder-client";
import { resolveFlyPreviewsForRepo } from "@dashboard/lib/previews/config";
import {
  appExists,
  destroyApp,
  flyHostname,
  listMachines,
  startMachine,
  waitForMachineStarted,
  type FlyPreviewConfig,
  type MachineInfo,
} from "@dashboard/lib/previews/fly-previews";
import {
  previewAppName,
  type BranchPreviewKey,
  type PreviewKey,
  type PrPreviewKey,
} from "@dashboard/lib/previews/preview-key";
import { loadVaultContextForBuild } from "@dashboard/lib/previews/vault-build-context";

export type CreateFlyDeploymentInput = (PrPreviewKey | BranchPreviewKey) & {
  ref: string;
  imageTag?: string;
  githubToken?: string;
};

export interface FlyDeploymentInfo {
  key: PreviewKey;
  appName: string;
  url: string | null;
  machineId?: string;
  state: "building" | "failed" | "pending" | "starting" | "running" | "unknown";
  region: string;
  builderMachineId?: string;
}

const PREVIEW_WAKE_WAIT_MS = 20_000;

async function getEmptyDeploymentInfo(
  key: PreviewKey,
  appName: string,
  cfg: FlyPreviewConfig,
): Promise<FlyDeploymentInfo> {
  const builder = await getPreviewBuilderStatus(appName, cfg.token);
  return {
    key,
    appName,
    url: null,
    state: builder?.state ?? "failed",
    region: cfg.defaultRegion,
    builderMachineId: builder?.machineId,
  };
}

function deploymentInfoFromMachine(
  key: PreviewKey,
  appName: string,
  machine: MachineInfo,
  cfg: FlyPreviewConfig,
): FlyDeploymentInfo {
  return {
    key,
    appName,
    url: flyHostname(appName),
    machineId: machine.id,
    state:
      machine.state === "started"
        ? "running"
        : machine.state === "starting"
          ? "starting"
          : "unknown",
    region: machine.region ?? cfg.defaultRegion,
  };
}

export type FlyDeploymentProvider = DeploymentProvider<
  FlyPreviewConfig,
  CreateFlyDeploymentInput,
  PreviewKey,
  FlyDeploymentInfo
>;

export const flyDeploymentProvider: FlyDeploymentProvider = {
  id: "fly",
  area: "deployments",
  capabilities: new Set([
    "deploy-preview",
    "expose-http",
    "wake",
    "destroy",
    "inventory",
  ]),
  async create(input, cfg) {
    const key: PreviewKey =
      "pr" in input
        ? { repo: input.repo, pr: input.pr }
        : { repo: input.repo, branch: input.branch };
    const appName = previewAppName(key);

    const { buildEnv, buildMode } = await loadVaultContextForBuild(
      input.repo,
      input.githubToken,
    );

    const previews = await resolveFlyPreviewsForRepo(
      input.repo,
      input.githubToken,
    );

    let spawned: SpawnBuilderResult;
    try {
      spawned = await spawnPreviewBuilder({
        repo: input.repo,
        ...("pr" in input ? { pr: input.pr } : {}),
        ...("branch" in input ? { branch: input.branch } : {}),
        ref: input.ref,
        appName,
        imageTag: input.imageTag,
        flyToken: cfg.token,
        flyOrgSlug: cfg.orgSlug,
        flyRegion: cfg.defaultRegion,
        githubToken: input.githubToken,
        buildEnv,
        buildMode,
        previewVmCpus: previews.cpus,
        previewVmMemoryMb: previews.memoryMb,
        previewIdleSuspend: previews.idleSuspend,
        previewHealthCheck: previews.healthCheck,
        builderCpus: previews.builderCpus,
        builderMemoryMb: previews.builderMemoryMb,
      });
    } catch (err) {
      logger.error(
        { err, repo: input.repo, appName, ref: input.ref },
        "preview: builder spawn failed",
      );
      throw err;
    }

    return {
      key,
      appName,
      url: spawned.expectedUrl,
      state: "pending",
      region: cfg.defaultRegion,
      builderMachineId: spawned.machineId,
    };
  },
  async destroy(key, cfg) {
    await destroyApp(previewAppName(key), cfg);
  },
  async get(key, cfg) {
    const appName = previewAppName(key);
    if (!(await appExists(appName, cfg))) return null;

    const machines = await listMachines(appName, cfg);
    const first = machines[0];
    if (!first) return getEmptyDeploymentInfo(key, appName, cfg);

    return deploymentInfoFromMachine(key, appName, first, cfg);
  },
  async wake(key, cfg) {
    const appName = previewAppName(key);
    if (!(await appExists(appName, cfg))) return null;

    const machines = await listMachines(appName, cfg);
    const first = machines[0];
    if (!first) return getEmptyDeploymentInfo(key, appName, cfg);

    if (first.state !== "started") {
      if (first.state !== "starting") {
        await startMachine(appName, first.id, cfg);
      }

      try {
        await waitForMachineStarted(
          appName,
          first.id,
          cfg,
          PREVIEW_WAKE_WAIT_MS,
        );
      } catch (err) {
        logger.warn(
          { err, appName, machineId: first.id, state: first.state },
          "previews: wake wait did not reach started state",
        );
      }

      const refreshed = (await listMachines(appName, cfg)).find(
        (machine) => machine.id === first.id,
      );
      if (refreshed) return deploymentInfoFromMachine(key, appName, refreshed, cfg);
    }

    return deploymentInfoFromMachine(key, appName, first, cfg);
  },
};
