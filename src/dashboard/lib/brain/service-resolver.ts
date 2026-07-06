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
  | "machine_lookup_failed"
  | "fly_access_denied";

export interface BrainServiceResolution {
  app: string;
  orgSlug: string;
  defaultRegion: string;
  flyToken: string;
  stored: BrainAppFile | null;
  state: BrainStatusResult["state"];
  url?: string;
  machineId?: string;
  machineImageRef?: string;
  machine?: FlyMachineRow;
  reason?: BrainServiceReason;
}

function envFlyTokenFallback(primaryToken: string): string | undefined {
  const token =
    process.env.FLY_API_TOKEN?.trim() || process.env.FLY_IO_TOKEN?.trim();
  return token && token !== primaryToken ? token : undefined;
}

function sameResolvedBrainMachine(
  a: BrainServiceResolution,
  b: BrainServiceResolution,
): boolean {
  return Boolean(
    a.app === b.app &&
      a.machineId &&
      b.machineId &&
      a.machineId === b.machineId,
  );
}

function flyAccessDenied(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Fly Machines API (401|403)|unauthorized|forbidden/i.test(message);
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

  const resolveWithToken = async (
    flyToken: string,
  ): Promise<BrainServiceResolution> => {
    const status = await brainStatus({
      flyToken,
      account: input.account,
      appNameOverride: app,
      machineIdOverride: targetMachineId,
      orgSlug,
      defaultRegion: input.defaultRegion,
    });

    let machine: FlyMachineRow | undefined;
    let machineLookupFailed = false;
    let machineAccessDenied = Boolean(status.accessDenied);
    try {
      const machines = await listMachines(app, {
        token: flyToken,
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
    } catch (err) {
      machineLookupFailed = true;
      machineAccessDenied = machineAccessDenied || flyAccessDenied(err);
    }

    const reason: BrainServiceReason | undefined =
      machineAccessDenied
        ? "fly_access_denied"
        : targetMachineId && !machine && !machineLookupFailed
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
      flyToken,
      stored,
      state: status.state,
      url: status.url,
      machineId: machine?.machineId ?? targetMachineId ?? status.machineId,
      machineImageRef: machine?.imageRef ?? status.machineImageRef,
      machine,
      reason,
    };
  };

  const primary = await resolveWithToken(input.flyToken);
  const fallback =
    stored || runtime?.runningApp
      ? envFlyTokenFallback(input.flyToken)
      : undefined;
  if (fallback) {
    const fallbackResult = await resolveWithToken(fallback).catch(() => null);
    if (
      fallbackResult &&
      (primary.machine
        ? sameResolvedBrainMachine(primary, fallbackResult)
        : fallbackResult.machine || fallbackResult.state !== "off")
    ) {
      return fallbackResult;
    }
  }
  return primary;
}
