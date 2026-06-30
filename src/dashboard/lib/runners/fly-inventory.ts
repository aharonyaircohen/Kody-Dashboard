/**
 * @fileType library
 * @domain runner
 * @pattern fly-inventory
 * @ai-summary Read-only Fly machine inventory: lists all kody-managed machines
 *   (preview, runner, brain, builder) the token can see. Uses the
 *   connected repo's FLY_API_TOKEN — surfaces only machines the authenticated
 *   user owns. Errors during per-app listing are skipped (best-effort); a bad
 *   app never fails the whole inventory.
 *
 * Classification is by app-name shape (see preview-key.ts for the `kp-` scheme
 * and the runner/brain app names). Billing rule unchanged: this uses
 * the connected repo's FLY_API_TOKEN, so it lists that account's machines.
 */

import {
  listAppsByPrefix,
  listMachines,
  type MachineInfo,
  type FlyPreviewConfig,
} from "@dashboard/lib/previews/fly-previews";
import {
  isFlyMachineRunning,
  type FlyFeature,
  type FlyInventory,
  type FlyMachineRow,
} from "./fly-machine-model";

export type {
  FlyFeature,
  FlyInventory,
  FlyMachineRow,
} from "./fly-machine-model";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Map an app name to its owning feature + a friendly label. */
export function classifyApp(app: string): {
  feature: FlyFeature;
  label: string;
} {
  if (app === "kody-preview-builder" || app.startsWith("fly-builder-"))
    return { feature: "builder", label: app };
  if (app.startsWith("kody-brain")) return { feature: "brain", label: app };
  if (app === "kody-runner" || app.startsWith("kody-runner"))
    return { feature: "runner", label: app };
  if (app.startsWith("kp-")) {
    if (app.endsWith("-base"))
      return { feature: "preview-base", label: "base image" };
    const pr = app.match(/-pr-(\d+)$/);
    if (pr) return { feature: "preview", label: `PR #${pr[1]}` };
    if (/-br-[0-9a-f]+$/.test(app))
      return { feature: "preview", label: "branch" };
    if (/-st-[0-9a-f]+$/.test(app))
      return { feature: "preview", label: "static" };
    return { feature: "preview", label: app };
  }
  return { feature: "other", label: app };
}

function sizeLabel(guest?: {
  cpuKind?: string;
  cpus?: number;
  memoryMb?: number;
}): string {
  if (!guest || !guest.cpus) return "—";
  const kind = guest.cpuKind === "performance" ? "perf" : "shared";
  const gb =
    guest.memoryMb && guest.memoryMb >= 1024
      ? `${(guest.memoryMb / 1024).toFixed(guest.memoryMb % 1024 ? 1 : 0)} GB`
      : `${guest.memoryMb ?? "?"} MB`;
  return `${kind} ${guest.cpus}x · ${gb}`;
}

/** Run `fn` over `items` with a bounded concurrency so we don't fire 50+
 * simultaneous Fly calls (which trips rate limits / socket exhaustion). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

export function rowsForFlyApp(
  app: string,
  machines: MachineInfo[],
  now: number = Date.now(),
  override?: { feature?: FlyFeature; label?: string },
): FlyMachineRow[] {
  const classified = classifyApp(app);
  const feature = override?.feature ?? classified.feature;
  const label = override?.label ?? classified.label;
  return machines.map<FlyMachineRow>((m) => {
    const created = m.createdAt ? Date.parse(m.createdAt) : NaN;
    return {
      feature,
      app,
      machineId: m.id,
      name: m.name,
      state: m.state,
      region: m.region,
      label,
      sizeLabel: sizeLabel(m.guest),
      guest: m.guest,
      createdAt: m.createdAt,
      ageDays: Number.isFinite(created)
        ? Math.floor((now - created) / MS_PER_DAY)
        : undefined,
    };
  });
}

/**
 * List + classify every kody-managed Fly machine the token can see. Apps that
 * error during machine listing are skipped (best-effort) rather than failing
 * the whole inventory.
 */
export async function listFlyInventory(
  cfg: FlyPreviewConfig,
  now: number = Date.now(),
): Promise<FlyInventory> {
  const allApps = await listAppsByPrefix("", cfg);
  const apps = allApps.filter(
    (n) =>
      n.startsWith("kp-") ||
      n === "kody-preview-builder" ||
      n === "kody-runner" ||
      n.startsWith("kody-runner") ||
      n.startsWith("kody-brain") ||
      n.startsWith("fly-builder-"),
  );

  const perApp = await mapLimit(apps, 8, async (app) => {
    const { feature, label } = classifyApp(app);
    try {
      const machines = await listMachines(app, cfg);
      return rowsForFlyApp(app, machines, now, { feature, label });
    } catch {
      return [] as FlyMachineRow[];
    }
  });

  const machines = perApp.flat();
  return {
    machines,
    running: machines.filter((m) => isFlyMachineRunning(m.state)).length,
    total: machines.length,
  };
}
