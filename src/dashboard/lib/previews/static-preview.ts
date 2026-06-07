/**
 * @fileType library
 * @domain previews
 * @pattern static-file-preview
 * @ai-summary Static-file preview with no Docker build — boot a
 *   stock static-server image (`nginx:alpine` by default) and inject
 *   the uploaded file(s) via Fly's `config.files`. Ready in seconds
 *   (no `pnpm install`, no `next build`). Status + teardown reuse
 *   the regular `preview-lifecycle.ts` paths via `StaticPreviewKey`.
 *
 * Serve an uploaded static file (HTML, PDF, image…) as a Fly preview —
 * with NO builder and NO Docker build.
 *
 * Unlike PR/branch previews (which clone a repo and build an image on a
 * one-shot builder machine), a static preview boots a stock static-server
 * image (`nginx:alpine` by default) and injects the uploaded file(s)
 * straight into the machine via Fly's `config.files`. That means it's
 * ready in seconds, not minutes, and the dashboard's only Fly calls are
 * createApp → allocateSharedIps → createMachine.
 *
 * Lifecycle reuse: status (`getPreview`) and teardown (`destroyPreview`)
 * in `preview-lifecycle.ts` already work for any `PreviewKey`, so a
 * `StaticPreviewKey` flows through them unchanged. Only *creation* differs,
 * which is what this file provides.
 *
 * Per-repo billing: the caller passes the target repo's own
 * `FlyPreviewConfig` (resolved from that repo's vault `FLY_API_TOKEN`).
 */

import { logger } from "@dashboard/lib/logger";
import {
  allocateSharedIps,
  createApp,
  createMachine,
  flyHostname,
  type FlyPreviewConfig,
} from "@dashboard/lib/previews/fly-previews";
import {
  previewAppName,
  type StaticPreviewKey,
} from "@dashboard/lib/previews/preview-key";

/** Stock image + web root + port. Overridable, but the defaults serve any
 *  static file with correct content-types out of the box. */
const STATIC_IMAGE = process.env.KODY_PREVIEW_STATIC_IMAGE ?? "nginx:alpine";
const STATIC_WEB_ROOT =
  process.env.KODY_PREVIEW_STATIC_WEB_ROOT ?? "/usr/share/nginx/html";
const STATIC_INTERNAL_PORT = Number(
  process.env.KODY_PREVIEW_STATIC_PORT ?? "80",
);

export interface StaticPreviewFile {
  /** Path under the web root, e.g. `index.html` or `report.pdf`. */
  path: string;
  /** Base64-encoded file contents. */
  contentBase64: string;
}

export interface CreateStaticPreviewInput extends StaticPreviewKey {
  files: StaticPreviewFile[];
}

export interface StaticPreviewInfo {
  appName: string;
  url: string;
  machineId: string;
  state: "starting" | "running" | "unknown";
  region: string;
}

export async function createStaticPreview(
  input: CreateStaticPreviewInput,
  cfg: FlyPreviewConfig,
): Promise<StaticPreviewInfo> {
  if (input.files.length === 0) {
    throw new Error("createStaticPreview: no files to serve");
  }
  const key: StaticPreviewKey = {
    repo: input.repo,
    staticId: input.staticId,
  };
  const appName = previewAppName(key);

  await createApp(appName, cfg);
  await allocateSharedIps(appName, cfg);

  const machine = await createMachine(
    {
      appName,
      region: cfg.defaultRegion,
      image: STATIC_IMAGE,
      internalPort: STATIC_INTERNAL_PORT,
      memoryMb: 256,
      cpus: 1,
      cpuKind: "shared",
      files: input.files.map((f) => ({
        guestPath: `${STATIC_WEB_ROOT}/${f.path}`,
        contentBase64: f.contentBase64,
      })),
    },
    cfg,
  );

  logger.info(
    { repo: input.repo, appName, files: input.files.length },
    "static-preview: created (no build)",
  );

  return {
    appName,
    url: flyHostname(appName),
    machineId: machine.id,
    state:
      machine.state === "started"
        ? "running"
        : machine.state === "starting"
          ? "starting"
          : "unknown",
    region: machine.region || cfg.defaultRegion,
  };
}
