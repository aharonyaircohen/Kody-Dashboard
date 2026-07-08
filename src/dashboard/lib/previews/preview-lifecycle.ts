// =============================================================================
// `previews/` — per-PR preview hosting on Fly Machines
// =============================================================================
//
// This folder owns the dashboard side of per-PR preview hosting. PR opens /
// syncs / closes on a connected repo → a Fly Machine is built, the PR gets
// a stable `https://<app>.fly.dev` URL, and the app is torn down on close.
//
// Module map:
//
//   - `preview-lifecycle.ts`     (this file) — entry point. create / get /
//     destroy for a `PreviewKey`. The builder machine does the heavy lifting;
//     the dashboard just spawns it and queries Fly by deterministic app name.
//
//   - `webhook.ts`               — GitHub `pull_request` / `push` event
//     handlers wired from `app/api/webhooks/github/route.ts`. Translates
//     those events into lifecycle calls + base-image rebuilds.
//
//   - `preview-router.ts`        — decides Fly vs GitHub Actions for the
//     build step (Fly preferred for previews; inverts the engine's
//     GitHub-first policy).
//
//   - `builder-client.ts`       — the single Fly API call that spawns the
//     per-PR builder machine. Fire-and-forget.
//
//   - `fly-previews.ts`          — Fly Machines REST/GraphQL client tailored
//     to long-lived, auto-suspending preview apps.
//
//   - `config.ts`                — resolves per-repo Fly config (token, org,
//     region) from the target repo's vault. NEVER read Fly creds from
//     `process.env` — every preview is billed to the target repo.
//
//   - `vault-build-context.ts`   — which vault secrets get baked into the
//     preview image, and which Dockerfile variant the builder uses.
//
//   - `preview-key.ts`           — deterministic Fly app name from
//     (repo, pr|branch|staticId). Everything (status lookup, sweep, doorman
//     ticket binding) keys off these names — never change the hash without
//     a migration.
//
//   - `fly-pr-preview-url.ts`    — best-effort URL resolver used by the PR
//     page; returns `null` on any Fly hiccup so the page falls back to the
//     Vercel preview.
//
//   - `sweep.ts`                 — TTL-based cleanup of expired preview
//     apps. Opt-in via `fly.previews.ttlDays` (≤ 0 = no-op). Exempts the
//     per-repo base image.
//
//   - `static-preview.ts` +
//     `static-preview-client.ts` — serve an uploaded file (HTML/PDF/image)
//     as a Fly preview with NO build, NO clone. Reuses the lifecycle's
//     status + destroy.
//
//   - `base-rebuild.ts`          — keep the per-repo GHCR base image fresh
//     so per-PR builds can `FROM` it and skip the slow install/build steps.
//
// Load-bearing gotchas (every one of these has bitten us in production):
//
//   1. **Per-repo billing.** Every Fly API call MUST be authenticated with
//      the TARGET repo's `FLY_API_TOKEN` (resolved from its vault in
//      `config.ts`). Never fall back to a global / Vercel-env token — that
//      would bill one customer's previews against another.
//
//   2. **No preview state in the dashboard.** Status comes from Fly
//      (`getPreview` → `appExists` + `listMachines`) using the deterministic
//      app name. Storing a parallel preview state file would just drift.
//
//   3. **App-name stability is a contract.** Preview URLs, doorman ticket
//      binding, and the TTL sweep derive identity from `previewAppName(...)`.
//      Changing the hash scheme invalidates every running preview + every
//      open ticket.
//
//   4. **Static previews are NOT git-backed.** Their `PreviewKey` has
//      `staticId` not `pr`/`branch` — they're created/destroyed manually,
//      and the builder path is skipped entirely. Don't route them through
//      `createPreview` / `routePreviewBuild`.
//
//   5. **The Fly builder is preferred over GitHub Actions for builds** —
//      the GitHub path was crashing ~half of preview builds with
//      transient `ECONNRESET` on the `npx kody-engine@latest` download.
//      `preview-router.ts` encodes this preference.
// =============================================================================

/**
 * @fileType library
 * @domain previews
 * @pattern lifecycle-dispatch
 * @ai-summary Dashboard-side entry point for the per-PR preview lifecycle
 *   (create / get / destroy). The actual build work is delegated to a
 *   spawned Fly builder machine; this file is just the thin dispatch +
 *   status-query wrapper. Trap: it does NOT store preview state — status
 *   always re-asks Fly by deterministic app name, so any state you add
 *   here will drift from the source of truth.
 *
 * Per-PR preview lifecycle.
 *
 * Two operations, both cheap and synchronous from the dashboard side:
 *
 *   createPreview  — spawns a builder Fly Machine that handles the full
 *                    pipeline (build + push image + create app + IPs +
 *                    preview machine + exit). The dashboard's only Fly
 *                    interaction is the single spawn call (~1s).
 *
 *   destroyPreview — deletes the per-PR Fly app on PR close. Idempotent.
 *
 * Status lookups (getPreview) hit Fly's API directly using the
 * deterministic per-PR app name. The dashboard never stores preview
 * state of its own.
 */

import { getDeploymentProvider } from "@dashboard/lib/infrastructure/installed";
import type { FlyPreviewConfig } from "@dashboard/lib/previews/fly-previews";
import {
  type BranchPreviewKey,
  type PreviewKey,
  type PrPreviewKey,
} from "@dashboard/lib/previews/preview-key";

/**
 * The builder path only handles git-backed previews (PR or branch) — it
 * clones a ref and runs a real `docker build`. Static-file previews skip
 * the builder entirely (see `static-preview.ts`), so they're intentionally
 * excluded from this input type.
 */
export type CreatePreviewInput = (PrPreviewKey | BranchPreviewKey) & {
  ref: string;
  imageTag?: string;
  githubToken?: string;
};

export interface PreviewInfo {
  key: PreviewKey;
  appName: string;
  url: string | null;
  machineId?: string;
  state: "building" | "failed" | "pending" | "starting" | "running" | "unknown";
  region: string;
  /** Builder machine spawned for this run; useful for debugging logs. */
  builderMachineId?: string;
}

export async function createPreview(
  input: CreatePreviewInput,
  cfg: FlyPreviewConfig,
): Promise<PreviewInfo> {
  return getDeploymentProvider().create(input, cfg) as Promise<PreviewInfo>;
}

export async function destroyPreview(
  key: PreviewKey,
  cfg: FlyPreviewConfig,
): Promise<void> {
  await getDeploymentProvider().destroy(key, cfg);
}

export async function getPreview(
  key: PreviewKey,
  cfg: FlyPreviewConfig,
): Promise<PreviewInfo | null> {
  return getDeploymentProvider().get(key, cfg) as Promise<PreviewInfo | null>;
}

export async function wakePreview(
  key: PreviewKey,
  cfg: FlyPreviewConfig,
): Promise<PreviewInfo | null> {
  return getDeploymentProvider().wake!(key, cfg) as Promise<PreviewInfo | null>;
}
