/**
 * @fileType library
 * @domain previews
 * @pattern fly-machine-job
 *
 * Spawn a one-shot Fly Machine to build a preview image.
 *
 * Why this shape (vs an HTTP service): build runs can take 1–5 minutes,
 * and Fly's edge HTTP proxy drops idle connections after ~60s. The
 * Fly Machines API is built for long-running jobs — we ask Fly to
 * start a machine, then wait for it to reach the `destroyed` state.
 * The machine's exit code tells us whether the build succeeded.
 *
 * The machine pulls the builder image (`registry.fly.io/kody-preview-builder:latest`)
 * and runs the CLI in builder/src/builder.ts, which:
 *   1. Clones the repo at the given ref
 *   2. Falls back to the bundled default Dockerfile.preview if missing
 *   3. Runs `flyctl deploy --build-only --push` against the target app
 *   4. Exits 0 on success
 *
 * On success, the image lives at `registry.fly.io/<appName>:<imageTag>`.
 */

import { createHash } from "node:crypto";

import { logger } from "@dashboard/lib/logger";

const FLY_MACHINES_BASE = "https://api.machines.dev/v1";
const BUILDER_IMAGE =
  process.env.KODY_PREVIEW_BUILDER_IMAGE ??
  "registry.fly.io/kody-preview-builder:latest";
const BUILDER_HOST_APP =
  process.env.KODY_PREVIEW_BUILDER_HOST_APP ?? "kody-preview-builder";

// Hard ceiling for an end-to-end build. Long enough for the slowest
// Next.js cold build we'd reasonably accept; short enough that a hung
// flyctl doesn't pin a builder Machine indefinitely.
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

export interface BuildPreviewImageInput {
  /** owner/name */
  repo: string;
  ref: string;
  /** Fly app the resulting image will be tagged into (must already exist). */
  appName: string;
  imageTag?: string;
  flyToken: string;
  githubToken?: string;
}

export interface BuildPreviewImageResult {
  image: string;
  durationMs: number;
}

function defaultTagFor(repo: string, ref: string): string {
  return createHash("sha256")
    .update(`${repo}@${ref}`)
    .digest("hex")
    .slice(0, 12);
}

async function flyFetch(
  url: string,
  init: RequestInit,
  token: string,
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
}

interface MachineState {
  id: string;
  state: string;
  /** Set once the guest has exited (read from events[].request.exit_event). */
  exit_code?: number;
  /** True once any terminal event has fired (exit/stop/destroy). */
  isTerminal: boolean;
}

async function getMachineState(
  appName: string,
  machineId: string,
  token: string,
): Promise<MachineState | null> {
  const res = await flyFetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}?include_deleted=true`,
    { method: "GET" },
    token,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`getMachineState ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    id: string;
    state: string;
    events?: Array<{
      type?: string;
      status?: string;
      request?: { exit_event?: { exit_code?: number } };
    }>;
  };
  // Exit code lives in the most recent `type: "exit"` event.
  const exitEvent = (data.events ?? []).find((e) => e.type === "exit");
  const exit_code = exitEvent?.request?.exit_event?.exit_code;
  const isTerminal =
    data.state === "stopped" ||
    data.state === "destroyed" ||
    exit_code !== undefined;
  return { id: data.id, state: data.state, exit_code, isTerminal };
}

async function destroyMachine(
  appName: string,
  machineId: string,
  token: string,
): Promise<void> {
  await flyFetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}?force=true`,
    { method: "DELETE" },
    token,
  ).catch(() => undefined);
}

export async function buildPreviewImage(
  input: BuildPreviewImageInput,
): Promise<BuildPreviewImageResult> {
  const startedAt = Date.now();
  const tag = input.imageTag ?? defaultTagFor(input.repo, input.ref);
  const imageRef = `registry.fly.io/${input.appName}:${tag}`;

  // Spawn the builder machine inside the BUILDER_HOST_APP.
  // auto_destroy: true so Fly cleans up after the CLI exits — we still
  // read exit_code from `events[]` via include_deleted=true, so we don't
  // need the machine record to stick around.
  const body = {
    config: {
      image: BUILDER_IMAGE,
      env: {
        REPO: input.repo,
        REF: input.ref,
        APP_NAME: input.appName,
        IMAGE_TAG: tag,
        FLY_API_TOKEN: input.flyToken,
        ...(input.githubToken ? { GITHUB_TOKEN: input.githubToken } : {}),
      },
      auto_destroy: true,
      restart: { policy: "no" },
      guest: { cpu_kind: "shared", cpus: 2, memory_mb: 1024 },
    },
    region: "fra",
  };

  const createRes = await flyFetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(BUILDER_HOST_APP)}/machines`,
    { method: "POST", body: JSON.stringify(body) },
    input.flyToken,
  );
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    throw new Error(
      `builder machine create failed: ${createRes.status} ${text.slice(0, 300)}`,
    );
  }
  const created = (await createRes.json()) as { id: string };
  const machineId = created.id;

  logger.info(
    { repo: input.repo, ref: input.ref, machineId },
    "previews.builder: machine spawned",
  );

  // Poll until the machine has an exit event in its history.
  // include_deleted=true keeps the events readable even after auto_destroy.
  const deadline = startedAt + BUILD_TIMEOUT_MS;
  let lastState: MachineState | null = null;
  let timedOut = true;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    lastState = await getMachineState(
      BUILDER_HOST_APP,
      machineId,
      input.flyToken,
    ).catch(() => null);

    if (lastState?.isTerminal) {
      timedOut = false;
      break;
    }
  }

  if (timedOut) {
    // Best-effort cleanup if the machine got stuck.
    await destroyMachine(BUILDER_HOST_APP, machineId, input.flyToken);
    throw new Error(
      `builder timed out after ${Math.round(BUILD_TIMEOUT_MS / 1000)}s (last state: ${lastState?.state ?? "unknown"})`,
    );
  }

  if (lastState?.exit_code === undefined) {
    throw new Error(
      `builder finished but exit code unknown — check Fly logs for ${BUILDER_HOST_APP}/${machineId}`,
    );
  }
  if (lastState.exit_code !== 0) {
    throw new Error(
      `builder exited with code ${lastState.exit_code} — check Fly logs for ${BUILDER_HOST_APP}/${machineId}`,
    );
  }

  return { image: imageRef, durationMs: Date.now() - startedAt };
}
