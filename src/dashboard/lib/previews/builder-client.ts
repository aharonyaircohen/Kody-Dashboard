/**
 * @fileType library
 * @domain previews
 * @pattern builder-client
 *
 * Dashboard-side client for the preview builder Fly service
 * (kody-preview-builder). Sends `{ repo, ref, appName, flyToken }`,
 * gets back `{ image }` ready to boot.
 *
 * Auth: shared key derived from KODY_MASTER_KEY via the same
 * purpose-prefix scheme as the builder side (see builder/src/auth.ts).
 * Both sides compute the key independently — nothing crosses the wire.
 *
 * Failure mode: build is a hard dependency (unlike the warm pool). If
 * the builder is down, there's no image to boot, so we surface the
 * failure to the caller. The caller turns it into a 5xx.
 */

import { createHash } from "node:crypto";

import { logger } from "@dashboard/lib/logger";

const DEFAULT_BUILDER_URL = "https://kody-preview-builder.fly.dev";
const BUILD_TIMEOUT_MS = 10 * 60 * 1000; // 10 min cap for the whole build

function builderBaseUrl(): string {
  return (process.env.KODY_PREVIEW_BUILDER_URL ?? DEFAULT_BUILDER_URL).replace(
    /\/+$/,
    "",
  );
}

function deriveAuthKey(): string | null {
  const master = (process.env.KODY_MASTER_KEY ?? "").trim();
  if (!master) return null;
  return createHash("sha256")
    .update(`kody-preview-builder:v1:${master}`)
    .digest("hex");
}

export interface BuildPreviewImageInput {
  /** owner/name */
  repo: string;
  ref: string;
  /** Fly app the resulting image will be tagged into. */
  appName: string;
  imageTag?: string;
  flyToken: string;
  githubToken?: string;
}

export interface BuildPreviewImageResult {
  image: string;
  durationMs: number;
}

export async function buildPreviewImage(
  input: BuildPreviewImageInput,
): Promise<BuildPreviewImageResult> {
  const key = deriveAuthKey();
  if (!key) {
    throw new Error(
      "preview builder not configured: KODY_MASTER_KEY missing on dashboard",
    );
  }

  const url = `${builderBaseUrl()}/build`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-builder-auth": key,
    },
    body: JSON.stringify({
      repo: input.repo,
      ref: input.ref,
      appName: input.appName,
      imageTag: input.imageTag,
      flyToken: input.flyToken,
      githubToken: input.githubToken,
    }),
    signal: AbortSignal.timeout(BUILD_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error(
      { status: res.status, body: text.slice(0, 500), repo: input.repo, ref: input.ref },
      "previews.builder: build failed",
    );
    throw new Error(
      `builder ${res.status}: ${text.slice(0, 300) || res.statusText}`,
    );
  }

  return (await res.json()) as BuildPreviewImageResult;
}
