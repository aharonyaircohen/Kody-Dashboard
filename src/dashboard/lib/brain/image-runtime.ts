/**
 * @fileType utility
 * @domain brain
 * @pattern brain-image-runtime-restore
 *
 * @ai-summary Restore-side helpers for saved Brain images. The durable
 *   source of truth is GHCR (the `ghcr.io/<owner>/kody-brain-<account>:*`
 *   refs saved by `image-save.ts`); this module copies each saved image
 *   into a per-app Fly registry (`registry.fly.io/<app>:<tag>`) only as a
 *   runtime cache. Trap: because Fly only ever sees the per-app copy,
 *   private full Brain images never have to be made public at GHCR — but
 *   it also means the GHCR ref is the one to keep, not the Fly ref. Don't
 *   delete a GHCR ref assuming Fly still has it (Fly's registry is wiped
 *   with the app). The shell command here runs on the bridge machine, not
 *   on the Brain itself — keep it portable.
 */

import { isValidBrainImageRef } from "@dashboard/lib/brain/store";
import {
  BRAIN_IMAGE_JOB_OUTPUT_BYTES,
  brainImageJobTimeoutMs,
} from "@dashboard/lib/brain/image-timeouts";
import { ensureTerminalBridge } from "@dashboard/lib/terminal/bridge-fly";
import { runTerminalBridgeLocalExec } from "@dashboard/lib/terminal/bridge-exec-client";
import { mintTerminalBridgeToken } from "@dashboard/lib/terminal/terminal-token";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function dockerNamePart(value: string, field: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(normalized)) {
    throw new Error(`Invalid Brain image ${field}`);
  }
  return normalized;
}

function imageTag(imageRef: string): string {
  const withoutDigest = imageRef.split("@")[0] ?? imageRef;
  const marker = withoutDigest.lastIndexOf(":");
  if (marker === -1) throw new Error("Invalid Brain image tag");
  const tag = withoutDigest.slice(marker + 1);
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) {
    throw new Error("Invalid Brain image tag");
  }
  return tag;
}

export function brainGhcrAuth(input: {
  allSecrets: Record<string, string>;
  githubToken: string;
  account: string;
}): { token: string; user: string } {
  return {
    token:
      input.allSecrets.GHCR_TOKEN?.trim() ||
      input.allSecrets.GITHUB_TOKEN?.trim() ||
      input.githubToken,
    user: input.allSecrets.GHCR_USER?.trim() || input.account,
  };
}

export function brainFlyRuntimeImageRef(input: {
  app: string;
  imageRef: string;
}): string {
  const app = dockerNamePart(input.app, "app");
  return `registry.fly.io/${app}:${imageTag(input.imageRef)}`;
}

export function brainImageRestoreCommand(input: {
  sourceImageRef: string;
  runtimeImageRef: string;
  ghcrUser: string;
}): string {
  if (!isValidBrainImageRef(input.sourceImageRef)) {
    throw new Error("Invalid Brain GHCR image ref");
  }
  if (
    !/^registry\.fly\.io\/[a-z0-9][a-z0-9._-]*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(
      input.runtimeImageRef,
    )
  ) {
    throw new Error("Invalid Brain runtime image ref");
  }
  const ghcrUser = dockerNamePart(input.ghcrUser, "GHCR user");
  return String.raw`/bin/bash -lc ${shellQuote(`
set -euo pipefail
source_image=${shellQuote(input.sourceImageRef)}
runtime_image=${shellQuote(input.runtimeImageRef)}
ghcr_user=${shellQuote(ghcrUser)}
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

if ! command -v skopeo >/dev/null 2>&1; then
  apt-get update >/dev/null
  apt-get install -y --no-install-recommends skopeo ca-certificates >/dev/null
  rm -rf /var/lib/apt/lists/*
fi

if [ -z "\${GHCR_TOKEN:-}" ]; then
  echo "GHCR_TOKEN missing; GitHub token needs write:packages/read:packages permission" >&2
  exit 1
fi

flyctl auth docker >/dev/null 2>&1 || true
printf '%s' "$GHCR_TOKEN" | skopeo login ghcr.io --username "$ghcr_user" --password-stdin >/dev/null

if ! skopeo copy --all "docker://$source_image" "docker://$runtime_image" > "$tmpdir/copy.log" 2>&1; then
  tail -n 200 "$tmpdir/copy.log" >&2
  exit 1
fi

printf '\\n__KODY_BRAIN_RUNTIME_IMAGE_REF=%s\\n' "$runtime_image"
`)}`;
}

export async function prepareBrainRuntimeImage(input: {
  owner: string;
  repo: string;
  app: string;
  imageRef: string;
  runtimeImageRef?: string;
  flyToken: string;
  ghcrToken: string;
  ghcrUser: string;
  orgSlug: string;
  defaultRegion: string;
}): Promise<string> {
  const runtimeImageRef =
    input.runtimeImageRef ??
    brainFlyRuntimeImageRef({
      app: input.app,
      imageRef: input.imageRef,
    });
  const bridge = await ensureTerminalBridge({
    token: input.flyToken,
    orgSlug: input.orgSlug,
    defaultRegion: input.defaultRegion,
  });
  const token = mintTerminalBridgeToken({
    owner: input.owner,
    repo: input.repo,
    app: input.app,
    orgSlug: input.orgSlug,
    flyToken: input.flyToken,
    ghcrToken: input.ghcrToken,
    localExec: true,
    ttlSeconds: 900,
    secret: bridge.secret,
  });
  const result = await runTerminalBridgeLocalExec({
    bridgeUrl: bridge.url,
    token,
    command: brainImageRestoreCommand({
      sourceImageRef: input.imageRef,
      runtimeImageRef,
      ghcrUser: input.ghcrUser,
    }),
    timeoutMs: brainImageJobTimeoutMs(),
    maxOutputBytes: BRAIN_IMAGE_JOB_OUTPUT_BYTES,
  });
  const match = result.stdout.match(
    /__KODY_BRAIN_RUNTIME_IMAGE_REF=(registry\.fly\.io\/[^\s]+)/,
  );
  if (!match?.[1]) {
    throw new Error("Brain image restore finished without a runtime image ref");
  }
  if (match[1] !== runtimeImageRef) {
    throw new Error("Brain image restore returned an unexpected runtime ref");
  }
  return runtimeImageRef;
}
