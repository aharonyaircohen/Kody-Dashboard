/**
 * Full-path live e2e against the deployed kody-preview-builder.
 *
 * Exercises every component:
 *   1. createPreview is called with `ref` (no image override)
 *   2. Lifecycle ensures the per-PR Fly app exists, then calls the
 *      builder over HTTPS with KODY_MASTER_KEY-derived shared-key auth
 *   3. Builder clones aguyaharonyair/kody-preview-smoke, drops in the
 *      bundled default Dockerfile.preview, runs `flyctl deploy
 *      --build-only --remote-only` against the per-PR app
 *   4. Lifecycle boots a machine from the produced image
 *   5. Test fetches https://<app>.fly.dev and asserts 200
 *   6. Tears down via destroyPreview
 *
 * Required env:
 *   FLY_API_TOKEN              org token, same as the dashboard uses
 *   KODY_MASTER_KEY            same value set on kody-preview-builder
 *   KODY_PREVIEW_BUILDER_URL   optional override (defaults to
 *                              https://kody-preview-builder.fly.dev)
 *
 * Auto-skips when either FLY_API_TOKEN or KODY_MASTER_KEY is missing.
 *
 * Cost per run: one short build (~1-2 min on Fly's builder) + a few
 * minutes of shared-cpu-1x. Roughly $0.01-$0.03.
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  destroyApp,
  type FlyPreviewConfig,
} from "@dashboard/lib/previews/fly-previews";
import {
  previewAppName,
  type PreviewKey,
} from "@dashboard/lib/previews/preview-key";
import {
  createPreview,
  destroyPreview,
} from "@dashboard/lib/previews/preview-lifecycle";

const FLY_TOKEN = process.env.FLY_API_TOKEN;
const MASTER_KEY = process.env.KODY_MASTER_KEY;

const cfg: FlyPreviewConfig = {
  token: FLY_TOKEN ?? "",
  orgSlug: process.env.FLY_ORG_SLUG || "personal",
  defaultRegion: process.env.FLY_DEFAULT_REGION || "fra",
};

const PR = Math.floor(Date.now() / 1000) % 1_000_000;
const KEY: PreviewKey = { repo: "aguyaharonyair/kody-preview-smoke", pr: PR };

describe.skipIf(!FLY_TOKEN || !MASTER_KEY)(
  "previews full-path live e2e (builder + Fly)",
  () => {
    afterAll(async () => {
      try {
        await destroyApp(previewAppName(KEY), cfg);
      } catch {
        /* already gone */
      }
    });

    it(
      "builds from ref, deploys, URL serves 200, tears down",
      async () => {
        const created = await createPreview(
          {
            repo: KEY.repo,
            pr: KEY.pr,
            ref: "main",
          },
          cfg,
        );

        expect(created.appName).toBe(previewAppName(KEY));
        expect(created.url).toBeTruthy();
        expect(created.url).toMatch(/^https:\/\/kp-.+\.fly\.dev$/);
        // createPreview now returns immediately after spawning the
        // builder machine — the URL isn't reachable yet. Pending state
        // is expected.
        expect(created.state).toBe("pending");
        expect(created.builderMachineId).toBeTruthy();

        // Wait for the builder to finish the full pipeline (build +
        // push + create preview machine). Longer timeout because we're
        // now polling the END URL, not the builder.
        let lastStatus = 0;
        let lastBody = "";
        for (let attempt = 0; attempt < 90; attempt++) {
          try {
            const res = await fetch(created.url!, {
              redirect: "follow",
              signal: AbortSignal.timeout(10_000),
            });
            lastStatus = res.status;
            lastBody = await res.text();
            if (res.status === 200) break;
          } catch {
            /* retrying */
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
        expect(
          lastStatus,
          `last response from ${created.url} body=${lastBody.slice(0, 400)}`,
        ).toBe(200);
        // Asserts our smoke page actually rendered.
        expect(lastBody).toMatch(/kody preview smoke OK/);

        await destroyPreview(KEY, cfg);
        await destroyPreview(KEY, cfg); // idempotent
      },
      15 * 60_000,
    );
  },
);

if (!FLY_TOKEN || !MASTER_KEY) {
  console.log(
    "[previews-builder-live] FLY_API_TOKEN or KODY_MASTER_KEY missing — skipping",
  );
}
