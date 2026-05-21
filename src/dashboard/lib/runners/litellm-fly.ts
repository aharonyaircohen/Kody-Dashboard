/**
 * @fileType library
 * @domain runners
 * @pattern fly-machines-litellm
 *
 * Read-only status probe for the shared always-on LiteLLM proxy app on Fly
 * (`kody-litellm`). Unlike brain-fly.ts (per-user, provisioned from the
 * dashboard) this app is deployed out-of-band via `fly deploy` in
 * kody2/litellm-server. The dashboard never creates or mutates it — it only
 * reports whether it's up so the Settings card can turn "assume it's there"
 * into "see it's there".
 *
 * Lives in the user's own Fly org (same org as the one-shot runners and the
 * Brain app), reachable over 6PN at `<app>.internal:4000`. So the status
 * check uses the same per-repo vault Fly token, and is gated on Fly being
 * configured at all — see [[project_fly_optional_gh_default]].
 */

import { flyFetch } from "@dashboard/lib/runners/brain-fly";

/** Fly app name for the shared LiteLLM proxy. Matches litellm-server/fly.toml. */
export const LITELLM_APP_NAME = process.env.FLY_LITELLM_APP ?? "kody-litellm";

export interface LitellmStatusInput {
  flyToken: string;
  /** Override the app name (tests). */
  appNameOverride?: string;
}

export interface LitellmStatusResult {
  app: string;
  /**
   * "running"   — at least one machine is started (proxy is hot).
   * "suspended" — machine exists but suspended (shouldn't happen for an
   *               always-on app, surfaced so a mis-config is visible).
   * "stopped"   — machine exists but stopped/off.
   * "off"       — app not deployed yet (no app or no machine).
   */
  state: "running" | "suspended" | "stopped" | "off";
  /** Count of non-destroyed machines (always-on expects ≥ 1). */
  machineCount: number;
}

// Minimal shapes — only the fields we read. Decoupled from brain-fly's
// private FlyApp/FlyMachine on purpose.
interface FlyAppLite {
  name: string;
}
interface FlyMachineLite {
  id: string;
  state?: string;
}

const RUNNING_STATES = new Set(["started", "starting", "created", "replacing"]);
const SUSPENDED_STATES = new Set(["suspended", "suspending"]);

/**
 * Report the live state of the shared LiteLLM app. Never mutates Fly.
 * Returns `{ state: "off" }` when the app isn't deployed.
 */
export async function litellmStatus(
  input: LitellmStatusInput,
): Promise<LitellmStatusResult> {
  if (!input.flyToken?.trim()) {
    throw new Error("litellm-fly: flyToken required");
  }
  const app = input.appNameOverride ?? LITELLM_APP_NAME;

  const existing = await flyFetch<FlyAppLite>(
    `/apps/${encodeURIComponent(app)}`,
    { token: input.flyToken, allow404: true },
  );
  if (!existing) {
    return { app, state: "off", machineCount: 0 };
  }

  const machines =
    (await flyFetch<FlyMachineLite[]>(
      `/apps/${encodeURIComponent(app)}/machines`,
      { token: input.flyToken, allow404: true },
    )) ?? [];

  const live = machines.filter(
    (m) => m.state !== "destroyed" && m.state !== "destroying",
  );
  if (live.length === 0) {
    return { app, state: "off", machineCount: 0 };
  }

  // Always-on app: "running" if any machine is up. Only when none are
  // running do we report the degraded suspended/stopped buckets.
  const anyRunning = live.some((m) => RUNNING_STATES.has(m.state ?? ""));
  const anySuspended = live.some((m) => SUSPENDED_STATES.has(m.state ?? ""));
  const state: LitellmStatusResult["state"] = anyRunning
    ? "running"
    : anySuspended
      ? "suspended"
      : "stopped";

  return { app, state, machineCount: live.length };
}
