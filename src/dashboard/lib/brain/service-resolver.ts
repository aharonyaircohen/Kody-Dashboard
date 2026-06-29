/**
 * @fileType service
 * @domain brain
 * @pattern brain-service-resolver
 *
 * Server-side source of truth for the user's Brain service. It combines the
 * dashboard's stored Brain record with Fly's live machine state.
 */
import "server-only";

import {
  readBrainApp,
  type BrainAppFile,
} from "@dashboard/lib/brain/store";
import { listMachines } from "@dashboard/lib/previews/fly-previews";
import {
  brainAppName,
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
  | "machine_lookup_failed";

export interface BrainServiceResolution {
  app: string;
  orgSlug: string;
  defaultRegion: string;
  stored: BrainAppFile | null;
  state: BrainStatusResult["state"];
  url?: string;
  machineId?: string;
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
}): Promise<BrainServiceResolution> {
  const stored = await readBrainApp(input.account, input.githubToken).catch(
    () => null,
  );
  const app =
    input.appNameOverride ?? stored?.appName ?? brainAppName(input.account);
  const orgSlug = stored?.orgSlug ?? input.orgSlug;

  const status = await brainStatus({
    flyToken: input.flyToken,
    account: input.account,
    appNameOverride: app,
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
    }).find((row) =>
      status.machineId ? row.machineId === status.machineId : true,
    );
  } catch {
    machineLookupFailed = true;
  }

  const reason: BrainServiceReason | undefined =
    machineLookupFailed && status.state !== "off"
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
    machineId: status.machineId,
    machine,
    reason,
  };
}
