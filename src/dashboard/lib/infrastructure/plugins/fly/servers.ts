/**
 * @fileType plugin
 * @domain infrastructure
 * @pattern fly-server-provider
 * @ai-summary Fly adapter for Kody servers: warm-pool claim first, then
 *   one-shot runner machine spawn. Vendor mechanics stay in this plugin.
 */

import type { ServerProvider } from "@dashboard/lib/infrastructure/contracts";
import type { InfrastructureServerOperations } from "@dashboard/lib/infrastructure/server-operations";
import { logger } from "@dashboard/lib/logger";
import { spawnRunner, type SpawnRunnerInput } from "./runners/fly";
import {
  flyConfigFromContext,
  resolveFlyContext,
  type FlyContext,
} from "./runners/context";
import type {
  ClaimOrRunServerOptions,
  ClaimOrRunServerResult,
} from "@dashboard/lib/runners/server-run";
import { claimFromPool } from "@dashboard/lib/runners/pool-client";
import * as brainOps from "./runners/brain";
import * as inventoryOps from "./runners/inventory";
import * as machineModelOps from "./runners/machine-model";
import * as activityOps from "./runners/activity";
import * as activityStoreOps from "./runners/activity-store";
import * as machineClientOps from "./previews/machines-client";
import * as terminalBridgeOps from "./terminal/bridge";

export type FlyServerProvider = ServerProvider<
  FlyContext,
  SpawnRunnerInput,
  Awaited<ReturnType<typeof spawnRunner>>,
  ClaimOrRunServerOptions,
  ClaimOrRunServerResult
>;

export const flyServerProvider: FlyServerProvider &
  InfrastructureServerOperations = {
  id: "fly",
  area: "servers",
  capabilities: new Set([
    "run-work",
    "claim-warm-runner",
    "wake",
    "destroy",
    "inventory",
  ]),
  async resolveContext(input) {
    return (await resolveFlyContext(
      (input as { request: Parameters<typeof resolveFlyContext>[0] }).request,
      (input as { options?: Parameters<typeof resolveFlyContext>[1] }).options,
    )) as Awaited<ReturnType<InfrastructureServerOperations["resolveContext"]>>;
  },
  isAvailable(ctx) {
    return !!ctx.flyToken;
  },
  configFromContext(ctx) {
    return flyConfigFromContext(ctx as FlyContext);
  },
  run(input) {
    return spawnRunner(input);
  },
  async claimOrRun(ctx, opts) {
    const { owner, repo, githubToken, allSecrets, flyToken, perfTier } = ctx;

    const claim = await claimFromPool({
      jobId: opts.taskId,
      repo: `${owner}/${repo}`,
      runRequest: opts.runRequest,
      ...(opts.idleExitMs ? { idleExitMs: opts.idleExitMs } : {}),
      ...(opts.hardCapMs ? { hardCapMs: opts.hardCapMs } : {}),
      dashboardUrl: opts.dashboardUrl,
      ...(opts.reasoningEffort
        ? { reasoningEffort: opts.reasoningEffort }
        : {}),
      ref: opts.ref,
    });
    if (claim.ok) {
      logger.info(
        { taskId: opts.taskId, machineId: claim.machineId, owner, repo },
        "fly: claimed warm pool machine",
      );
      return { runner: "pool", machineId: claim.machineId };
    }

    logger.info(
      { taskId: opts.taskId, owner, repo, poolMiss: claim.reason },
      "fly: pool miss - spawning fresh runner",
    );

    const { machineId } = await spawnRunner({
      repo: `${owner}/${repo}`,
      githubToken,
      runRequest: opts.runRequest,
      dashboardUrl: opts.dashboardUrl,
      ...(opts.idleExitMs ? { idleExitMs: opts.idleExitMs } : {}),
      ...(opts.hardCapMs ? { hardCapMs: opts.hardCapMs } : {}),
      ...(opts.reasoningEffort
        ? { reasoningEffort: opts.reasoningEffort }
        : {}),
      ref: opts.ref,
      allSecrets,
      flyToken,
      perfTier,
    });
    return { runner: "fly", machineId };
  },
  listMachines(appName, cfg) {
    return machineClientOps.listMachines(appName, cfg);
  },
  startMachine(appName, machineId, cfg) {
    return machineClientOps.startMachine(appName, machineId, cfg);
  },
  hostname(appName) {
    return machineClientOps.flyHostname(appName);
  },
  listInventory(cfg, now) {
    return inventoryOps.listFlyInventory(cfg, now);
  },
  rowsForApp(app, machines, now, override) {
    return inventoryOps.rowsForFlyApp(app, machines, now, override);
  },
  isMachineRunning(state) {
    return machineModelOps.isFlyMachineRunning(state);
  },
  emptyInventory() {
    return { machines: [], running: 0, total: 0 };
  },
  refreshInventoryCounts(inventory) {
    return {
      machines: inventory.machines,
      running: inventory.machines.filter((machine) =>
        machineModelOps.isFlyMachineRunning(machine.state),
      ).length,
      total: inventory.machines.length,
    };
  },
  applySavedBrainMachineToInventory(inventory, brain) {
    const app = brain.app;
    if (!brain.machine) {
      if (brain.stored) {
        inventory.machines = inventory.machines.filter(
          (machine) => machine.feature !== "brain" && machine.app !== app,
        );
      }
      return false;
    }
    inventory.machines = inventory.machines.filter(
      (machine) => machine.feature !== "brain" && machine.app !== app,
    );
    inventory.machines.push({ ...brain.machine, orgSlug: brain.orgSlug });
    return true;
  },
  async resolveSavedBrainServiceForRequest(req, context) {
    const { resolveSavedBrainServiceForRequest } =
      await import("./runners/inventory-server");
    return resolveSavedBrainServiceForRequest(req, context as never) as never;
  },
  brainAppName(account) {
    return brainOps.brainAppName(account);
  },
  get defaultBrainImage() {
    return brainOps.DEFAULT_IMAGE;
  },
  waitForBrainHealth(url, timeoutMs) {
    return brainOps.waitForBrainHealth(url, timeoutMs);
  },
  isBrainProvisionTransientError(error) {
    return brainOps.isBrainFlyProvisionTransientError(error);
  },
  provisionBrain(input) {
    return brainOps.provisionBrain({
      ...input,
      flyToken: input.providerToken,
    });
  },
  resumeBrain(input) {
    return brainOps.resumeBrain({
      ...input,
      flyToken: String(input.providerToken ?? input.flyToken ?? ""),
    } as Parameters<typeof brainOps.resumeBrain>[0]);
  },
  suspendBrain(input) {
    return brainOps.suspendBrain({
      ...input,
      flyToken: String(input.providerToken ?? input.flyToken ?? ""),
    } as Parameters<typeof brainOps.suspendBrain>[0]);
  },
  destroyBrain(input) {
    return brainOps.destroyBrain({
      ...input,
      flyToken: String(input.providerToken ?? input.flyToken ?? ""),
    } as Parameters<typeof brainOps.destroyBrain>[0]);
  },
  brainStatus(input) {
    return brainOps.brainStatus({
      ...input,
      flyToken: String(input.providerToken ?? input.flyToken ?? ""),
    } as Parameters<typeof brainOps.brainStatus>[0]);
  },
  updateBrainSuspension(input) {
    return brainOps.updateBrainSuspension({
      ...input,
      flyToken: String(input.providerToken ?? input.flyToken ?? ""),
    } as Parameters<typeof brainOps.updateBrainSuspension>[0]);
  },
  ensureTerminalBridge(cfg) {
    return terminalBridgeOps.ensureTerminalBridge(cfg);
  },
  findTerminalBridge(cfg) {
    return terminalBridgeOps.findTerminalBridge(cfg);
  },
  computeActivity(file) {
    return activityOps.computeActivity(file);
  },
  readActivityFile(octokit, owner, repo) {
    return activityStoreOps.readActivityFile(octokit, owner, repo);
  },
  recordSnapshot(octokit, owner, repo, snapshot) {
    return activityStoreOps.recordSnapshot(octokit, owner, repo, snapshot);
  },
  snapshotFromInventory(inventory, now) {
    return activityStoreOps.snapshotFromInventory(inventory, now);
  },
  createMachine(input, cfg) {
    return machineClientOps.createMachine(input, cfg);
  },
  createApp(appName, cfg) {
    return machineClientOps.createApp(appName, cfg);
  },
  allocateSharedIps(appName, cfg) {
    return machineClientOps.allocateSharedIps(appName, cfg);
  },
  alignPreviewMachineSleep(appName, machineId, cfg, options) {
    return machineClientOps.alignPreviewMachineSleep(
      appName,
      machineId,
      cfg,
      options,
    );
  },
  listAppsByPrefix(prefix, cfg) {
    return machineClientOps.listAppsByPrefix(prefix, cfg);
  },
  destroyMachine(appName, machineId, cfg) {
    return machineClientOps.destroyMachine(appName, machineId, cfg);
  },
  suspendMachine(appName, machineId, cfg) {
    return machineClientOps.suspendMachine(appName, machineId, cfg);
  },
  sleepPreviewMachine(appName, machineId, cfg, input) {
    return machineClientOps.sleepPreviewMachine(appName, machineId, cfg, input);
  },
  destroyApp(appName, cfg) {
    return machineClientOps.destroyApp(appName, cfg);
  },
};
