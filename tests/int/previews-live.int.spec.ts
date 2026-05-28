/**
 * Live integration test for the previews lifecycle module. Hits the
 * real Fly Machines API + GraphQL, boots a public hello image, verifies
 * the auto `<app>.fly.dev` URL serves 200, then destroys the app.
 *
 * What it proves end-to-end:
 *   1. App creation + shared IP allocation + machine boot all work
 *   2. The auto-issued HTTPS cert serves the URL within ~30s
 *   3. destroyPreview is idempotent (calls it twice; second is a no-op)
 *
 * Auto-skips if FLY_API_TOKEN is not set so CI without Fly stays green.
 *
 * Cost: < $0.01 per run (a few minutes of shared-cpu-1x).
 */

import { describe, expect, it, afterAll } from "vitest";

import { destroyApp, type FlyPreviewConfig } from "@dashboard/lib/previews/fly-previews";
import { previewAppName, type PreviewKey } from "@dashboard/lib/previews/preview-key";
import {
  createPreview,
  destroyPreview,
  getPreview,
} from "@dashboard/lib/previews/preview-lifecycle";

const TOKEN = process.env.FLY_API_TOKEN;
const ORG = process.env.FLY_ORG_SLUG || "personal";
const REGION = process.env.FLY_DEFAULT_REGION || "fra";

const cfg: FlyPreviewConfig = {
  token: TOKEN ?? "",
  orgSlug: ORG,
  defaultRegion: REGION,
};

// Use a synthetic PR number per run so reruns don't collide.
const PR = Math.floor(Date.now() / 1000) % 1_000_000;
const KEY: PreviewKey = { repo: "kody-previews-test/sample", pr: PR };

describe.skipIf(!TOKEN)(
  "previews live e2e (Fly Machines)",
  () => {
    afterAll(async () => {
      try {
        await destroyApp(previewAppName(KEY), cfg);
      } catch {
        /* already gone */
      }
    });

    it("create -> URL serves 200 -> destroy -> idempotent destroy", async () => {
      const created = await createPreview(
        {
          repo: KEY.repo,
          pr: KEY.pr,
          // ref is required even when image is provided (schema-level); the
          // builder is skipped when image is set, so this string is unused.
          ref: "main",
          image: "flyio/hellofly:latest",
          internalPort: 8080,
        },
        cfg,
      );

      expect(created.appName).toBe(previewAppName(KEY));
      expect(created.url).toMatch(/^https:\/\/kp-.+\.fly\.dev$/);
      expect(created.state).toBe("running");
      expect(created.machineId).toBeTruthy();

      let lastStatus = 0;
      let lastBody = "";
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const res = await fetch(created.url, {
            redirect: "follow",
            signal: AbortSignal.timeout(10_000),
          });
          lastStatus = res.status;
          lastBody = (await res.text()).slice(0, 200);
          if (res.status === 200) break;
        } catch {
          /* keep retrying */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      expect(
        lastStatus,
        `last response from ${created.url} body=${lastBody}`,
      ).toBe(200);

      const status = await getPreview(KEY, cfg);
      expect(status?.appName).toBe(created.appName);
      expect(status?.url).toBe(created.url);

      await destroyPreview(KEY, cfg);
      await destroyPreview(KEY, cfg); // idempotent

      const after = await getPreview(KEY, cfg);
      expect(after).toBeNull();
    }, 240_000);
  },
);

if (!TOKEN) {
  console.log("[previews-live] FLY_API_TOKEN not set — skipping");
}
