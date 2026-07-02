/**
 * @fileType service
 * @domain brain
 * @pattern brain-service-resolver
 *
 * @ai-summary Server-side source of truth for the user's Brain service.
 *   Combines the dashboard's stored Brain record (`store.ts`) with Fly's
 *   live status (`runners/brain-fly.ts::brainStatus` + Fly machine
 *   inventory) into a single `BrainServiceResolution`. The `reason` field
 *   (`not_provisioned` | `stored_app_not_found` | `app_has_no_machine` |
 *   `machine_lookup_failed`) is how the Runner page tells the user that
 *   dashboard state and Fly state have diverged (token revoked, app moved
 *   org, Fly API down). Trap: `listMachines` failures are silently caught
 *   and surfaced as `machine_lookup_failed` rather than thrown — callers
 *   MUST check `reason` and not assume a successful `state !== "off"`
 *   means we can reach the machine. Don't promote that catch to a throw
 *   without first checking every caller handles it.
 */
import "server-only";

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
  machineIdOverride?: string;
}): Promise<BrainServiceResolution> {
  const stored = await readBrainApp(input.account, input.githubToken).catch(
    () => null,
  );
  const target = resolveBrainTarget({
    account: input.account,
    contextOrgSlug: input.orgSlug,
    stored,
    appNameOverride: input.appNameOverride,
  });
  const app = target.app;
  const orgSlug = target.orgSlug;

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
    const targetMachineId = input.machineIdOverride ?? status.machineId;
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
    machineId: machine?.machineId ?? status.machineId,
    machine,
    reason,
  };
}
