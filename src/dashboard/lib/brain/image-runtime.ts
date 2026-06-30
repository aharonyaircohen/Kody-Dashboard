/**
 * @fileType utility
 * @domain brain
 * @pattern brain-image-runtime-restore
 *
 * Restore-side helpers for saved Brain images.
 *
 * Durable state points at GHCR. Fly gets a per-app registry copy only as a
 * runtime cache so private full Brain images do not need to be public.
 */

import { isValidBrainImageRef } from "@dashboard/lib/brain/store";
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
    timeoutMs: 840_000,
    maxOutputBytes: 8 * 1024 * 1024,
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
