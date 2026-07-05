/**
 * @fileType service
 * @domain brain
 * @pattern brain-service-resolver
 *
 * Server-side source of truth for the user's Brain service. It combines the
 * dashboard's stored Brain record with Fly's live machine state.
 */
import "server-only";

import { readBrainRuntimeView } from "@dashboard/lib/brain/runtime-manager";
import { readBrainApp, type BrainAppFile } from "@dashboard/lib/brain/store";
import { resolveBrainTarget } from "@dashboard/lib/brain/target";
import { listMachines } from "@dashboard/lib/previews/fly-previews";
import {
  brainStatus,
  type BrainStatusResult,
} from "@dashboard/lib/runners/brain-fly";
import {
  rowsForFlyApp,
  type FlyMachineRow,
} from "@dashboard/lib/runners/fly-inventory";

export type BrainServiceReason =
  | "not_provisioned"
  | "stored_app_not_found"
  | "app_has_no_machine"
  | "runtime_machine_not_found"
  | "machine_lookup_failed";

export interface BrainServiceResolution {
  app: string;
  orgSlug: string;
  defaultRegion: string;
  stored: BrainAppFile | null;
  state: BrainStatusResult["state"];
  url?: string;
  machineId?: string;
  machineImageRef?: string;
  machine?: FlyMachineRow;
  reason?: BrainServiceReason;
}

export async function resolveBrainService(input: {
  flyToken: string;
  account: string;
  githubToken: string;
  orgSlug: string;
  defaultRegion: string;
  appNameOverride?: string;
  machineIdOverride?: string;
}): Promise<BrainServiceResolution> {
  const stored = await readBrainApp(input.account, input.githubToken).catch(
    () => null,
  );
  const runtime = await readBrainRuntimeView(
    input.account,
    input.githubToken,
  ).catch(() => null);
  const target = resolveBrainTarget({
    account: input.account,
    contextOrgSlug: input.orgSlug,
    stored,
    appNameOverride: input.appNameOverride,
  });
  const app = input.appNameOverride ?? target.app;
  const orgSlug =
    runtime?.runningApp === app && runtime.runningOrgSlug
      ? runtime.runningOrgSlug
      : target.orgSlug;
  const runtimeMachineId =
    runtime?.runningApp === app ? runtime.runningMachineId : undefined;
  const targetMachineId = input.machineIdOverride ?? runtimeMachineId;

  const status = await brainStatus({
    flyToken: input.flyToken,
    account: input.account,
    appNameOverride: app,
    machineIdOverride: targetMachineId,
    orgSlug,
    defaultRegion: input.defaultRegion,
  });

  let machine: FlyMachineRow | undefined;
  let machineLookupFailed = false;
  try {
    const machines = await listMachines(app, {
      token: input.flyToken,
      orgSlug,
      defaultRegion: input.defaultRegion,
    });
    machine = rowsForFlyApp(app, machines, Date.now(), {
      feature: "brain",
      label: app,
      orgSlug,
    }).find((row) =>
      targetMachineId ? row.machineId === targetMachineId : true,
    );
  } catch {
    machineLookupFailed = true;
  }

  const reason: BrainServiceReason | undefined =
    targetMachineId && !machine && !machineLookupFailed
      ? "runtime_machine_not_found"
      : machineLookupFailed && status.state !== "off"
      ? "machine_lookup_failed"
      : status.state !== "off"
        ? undefined
        : stored
          ? status.url
            ? "app_has_no_machine"
            : "stored_app_not_found"
          : "not_provisioned";

  return {
    app: status.app,
    orgSlug: status.org ?? orgSlug,
    defaultRegion: input.defaultRegion,
    stored,
    state: status.state,
    url: status.url,
    machineId: machine?.machineId ?? targetMachineId ?? status.machineId,
    machineImageRef: machine?.imageRef ?? status.machineImageRef,
    machine,
    reason,
  };
}
