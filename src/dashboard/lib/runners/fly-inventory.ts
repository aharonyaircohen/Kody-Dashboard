/**
 * @fileType library
 * @domain runner
 * @pattern fly-inventory
 *
 * One read of every Fly machine the repo's token can see, classified by the
 * feature that owns it (preview / runner / brain / litellm / builder). Powers
 * the operator's Machines table on /runner — the single place to see what's
 * actually running and act on it.
 *
 * Classification is by app-name shape (see preview-key.ts for the `kp-` scheme
 * and the runner/brain/litellm app names). Billing rule unchanged: this uses
 * the connected repo's FLY_API_TOKEN, so it lists that account's machines.
 */

import {
  listAppsByPrefix,
  listMachines,
  type FlyPreviewConfig,
} from "@dashboard/lib/previews/fly-previews";

export type FlyFeature =
  | "preview"
  | "preview-base"
  | "runner"
  | "brain"
  | "litellm"
  | "builder"
  | "other";

export interface FlyMachineRow {
  feature: FlyFeature;
  app: string;
  machineId: string;
  name?: string;
  state: string;
  region: string;
  /** Human label, e.g. "PR #2350", "branch", "kody-litellm". */
  label: string;
  /** "shared 2x · 4 GB" or "—" when size is unknown. */
  sizeLabel: string;
  createdAt?: string;
  ageDays?: number;
}

export interface FlyInventory {
  machines: FlyMachineRow[];
  /** Count in a live (non-suspended/stopped) state — the ones costing CPU. */
  running: number;
  /** Total machines across all features. */
  total: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Map an app name to its owning feature + a friendly label. */
export function classifyApp(app: string): {
  feature: FlyFeature;
  label: string;
} {
  if (app === "kody-litellm") return { feature: "litellm", label: app };
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

/** A machine is "running" (paying for CPU) unless suspended/stopped. */
function isRunning(state: string): boolean {
  return state !== "suspended" && state !== "stopped" && state !== "destroyed";
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
      n.startsWith("kody-") ||
      n.startsWith("fly-builder-"),
  );

  const perApp = await mapLimit(apps, 8, async (app) => {
    const { feature, label } = classifyApp(app);
    try {
      const machines = await listMachines(app, cfg);
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
          createdAt: m.createdAt,
          ageDays: Number.isFinite(created)
            ? Math.floor((now - created) / MS_PER_DAY)
            : undefined,
        };
      });
    } catch {
      return [] as FlyMachineRow[];
    }
  });

  const machines = perApp.flat();
  return {
    machines,
    running: machines.filter((m) => isRunning(m.state)).length,
    total: machines.length,
  };
}
