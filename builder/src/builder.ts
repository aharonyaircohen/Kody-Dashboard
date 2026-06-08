/**
 * One-shot CLI that handles the FULL preview lifecycle inside a single
 * Fly machine. The dashboard webhook spawns this machine with a single
 * Fly Machines API call and returns immediately — no Vercel→Fly
 * polling, no long-lived serverless function.
 *
 * Lifecycle, all Fly→Fly:
 *   1. ensure per-PR Fly app exists
 *   2. allocate shared IPs (idempotent; runs in parallel with clone)
 *   3. clone repo at ref
 *   4. flyctl deploy --build-only --push (build + push image)
 *   5. destroy any stale preview machines
 *   6. create the new preview machine
 *   7. exit 0
 *
 * Required env:
 *   REPO              owner/name
 *   REF               branch or sha
 *   APP_NAME          per-PR Fly app name (kp-...)
 *   IMAGE_TAG         tag for the built image
 *   FLY_API_TOKEN     org token (also used for createApp + machine ops)
 *   FLY_ORG_SLUG      optional, defaults to "personal"
 *   FLY_REGION        optional, defaults to "fra"
 *   GITHUB_TOKEN      optional, for private clones AND for pushing the
 *                     base image to GHCR (needs `write:packages` scope
 *                     when MIRROR_TO_GHCR_OWNER is set)
 *   BUILD_ENV_JSON    optional JSON object of build-time secrets
 *                     (written as .env.production.local in the clone)
 *   MIRROR_TO_GHCR_OWNER  when set (e.g. "aguyaharonyair"), after a
 *                         successful base build the image is mirrored
 *                         to ghcr.io/<owner>/kp-<hash>-base:latest so
 *                         PR builds can FROM it without Fly auth.
 *
 * Exit codes:
 *   0  success — preview machine is running
 *   1  bad / missing inputs
 *   2  clone failed
 *   3  flyctl build failed
 *   4  Fly orchestration failed
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  allocateSharedIps,
  appExists,
  createApp,
  createPreviewMachine,
  destroyMachine,
  listMachines,
} from "./fly-api.ts";

const DEFAULT_BUILD_TIMEOUT_MS = 45 * 60 * 1000;

function defaultDockerfilePath(): string {
  // PREVIEW_BUILD_MODE selects which bundled template to drop in when
  // the consumer repo doesn't ship its own Dockerfile.preview.
  //
  // Default is "prod" — Vercel-style `next build` + `next start`.
  // Dev mode shifts the compile to first-request time on the small
  // preview machine, which for heavy apps ends up SLOWER end-to-end
  // than the build-time compile on Fly's beefier remote builder.
  // Repos that benefit from dev mode opt in explicitly.
  const mode = (process.env.PREVIEW_BUILD_MODE ?? "prod").trim().toLowerCase();
  if (mode === "dev") return "/app/default-Dockerfile.preview.dev";
  return "/app/default-Dockerfile.preview.prod";
}

function required(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) {
    console.error(`[builder] ${name} is required`);
    process.exit(1);
  }
  return v;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<number> {
  return new Promise((resolveFn) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: "inherit",
    });
    const timeoutMs = opts.timeoutMs;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timeout = setTimeout(() => {
        console.error(
          `[builder] ${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`,
        );
        child.kill("SIGTERM");
        const forceKill = setTimeout(() => child.kill("SIGKILL"), 10_000);
        forceKill.unref?.();
      }, timeoutMs);
      timeout.unref?.();
    }
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolveFn(code ?? -1);
    });
  });
}

async function cloneRepo(
  repo: string,
  ref: string,
  cwd: string,
  githubToken: string,
): Promise<void> {
  const cloneUrl = githubToken
    ? `https://x-access-token:${githubToken}@github.com/${repo}.git`
    : `https://github.com/${repo}.git`;

  console.log(`[builder] cloning ${repo}@${ref}`);
  const looksLikeSha = /^[0-9a-f]{7,40}$/i.test(ref);
  if (looksLikeSha) {
    if ((await run("git", ["clone", "--depth=1", cloneUrl, cwd])) !== 0) {
      process.exit(2);
    }
    if (
      (await run("git", ["fetch", "--depth=1", "origin", ref], { cwd })) !== 0
    ) {
      process.exit(2);
    }
    if (
      (await run("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd })) !== 0
    ) {
      process.exit(2);
    }
  } else {
    if (
      (await run("git", [
        "clone",
        "--depth=1",
        "--branch",
        ref,
        cloneUrl,
        cwd,
      ])) !== 0
    ) {
      process.exit(2);
    }
  }
}

/**
 * Compute the deterministic per-repo base-image app name.
 * Same hash shape as previewAppName but with a "-base" suffix instead
 * of "-pr-<n>", so the base image storage is shared across all PRs of
 * a given repo.
 */
function baseAppName(repo: string): string {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`invalid repo "${repo}"`);
  // Same SHA256 prefix scheme that preview-key.ts uses.
  const sha = (s: string) =>
    createHash("sha256").update(s).digest("hex").slice(0, 6);
  return `kp-${sha(owner)}-${sha(name)}-base`;
}

/**
 * Probe GHCR for a public base image. Returns the full image ref when
 * present, null otherwise. GHCR's public anonymous-pull token is
 * minted on demand; we use it to ask for the manifest.
 */
async function findBaseImage(
  repo: string,
  ghcrOwner: string,
): Promise<string | null> {
  const baseImage = `${ghcrOwner.toLowerCase()}/${baseAppName(repo)}`;
  // GHCR requires a bearer token even for public reads.
  const tokRes = await fetch(
    `https://ghcr.io/token?scope=repository:${baseImage}:pull&service=ghcr.io`,
    { signal: AbortSignal.timeout(15_000) },
  ).catch(() => null);
  if (!tokRes || !tokRes.ok) return null;
  const { token } = (await tokRes.json()) as { token: string };
  const res = await fetch(`https://ghcr.io/v2/${baseImage}/manifests/latest`, {
    method: "HEAD",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:
        "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
    },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || res.status !== 200) return null;
  return `ghcr.io/${baseImage}:latest`;
}

/**
 * Mirror the freshly-pushed base image from Fly's registry to GHCR
 * (public) so PR builds can FROM it inside flyctl's --remote-only
 * context (which can't auth to the Fly registry but doesn't need auth
 * for a public GHCR image).
 */
async function mirrorBaseToGhcr(
  repo: string,
  appName: string,
  imageTag: string,
  ghcrOwner: string,
  ghcrToken: string,
  flyToken: string,
): Promise<void> {
  const src = `docker://registry.fly.io/${appName}:${imageTag}`;
  const ownerLower = ghcrOwner.toLowerCase();
  const ghcrPath = `${ownerLower}/${baseAppName(repo)}`;
  const dst = `docker://ghcr.io/${ghcrPath}:latest`;
  console.log(`[builder] mirroring ${src} -> ${dst}`);
  const code = await run("skopeo", [
    "copy",
    `--src-creds=x:${flyToken}`,
    `--dest-creds=${ghcrOwner}:${ghcrToken}`,
    src,
    dst,
  ]);
  if (code !== 0) throw new Error("skopeo copy failed");
  // Make the package public so flyctl can FROM it without auth. Idempotent.
  const visRes = await fetch(
    `https://api.github.com/user/packages/container/${encodeURIComponent(
      baseAppName(repo),
    )}/visibility`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${ghcrToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ visibility: "public" }),
      signal: AbortSignal.timeout(15_000),
    },
  ).catch(() => null);
  if (visRes && visRes.status !== 204) {
    const text = await visRes.text().catch(() => "");
    console.warn(
      `[builder] make-public returned ${visRes.status}: ${text.slice(0, 200)}`,
    );
  }
}

/**
 * Idempotently post a "preview ready" comment on the PR. Uses a hidden
 * HTML marker to find an existing comment from a prior build and update
 * it in place, mirroring the Vercel preview-comment UX. Failure is
 * non-fatal — the preview itself is what users actually need.
 */
async function postPreviewComment(args: {
  repo: string;
  pr: number;
  appName: string;
  token: string;
  ref: string;
}): Promise<void> {
  const MARKER = "<!-- kody-fly-preview -->";
  // The preview URL is now token-gated (doorman proxy on :8080 validates a
  // signed ticket before proxying). The raw fly.dev URL would return 401
  // without a ticket from the dashboard. People reach previews through the
  // Kody dashboard (already behind login), which appends the ticket.
  const body = [
    MARKER,
    `✅ **Preview ready** — open it from the Kody dashboard.`,
    "",
    `<sub>App: \`${args.appName}\` · Commit: \`${args.ref.slice(0, 7)}\` · Updated: ${new Date().toISOString()}</sub>`,
  ].join("\n");

  const apiBase = `https://api.github.com/repos/${args.repo}/issues/${args.pr}/comments`;
  const headers = {
    Authorization: `Bearer ${args.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  // Walk existing comments to find any prior preview comment by marker.
  // PRs rarely exceed 30 comments for the kody bot path; one page is fine.
  const listRes = await fetch(`${apiBase}?per_page=100`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  let existingId: number | null = null;
  if (listRes && listRes.ok) {
    const comments = (await listRes.json().catch(() => [])) as Array<{
      id: number;
      body?: string;
    }>;
    const hit = comments.find((c) => (c.body ?? "").includes(MARKER));
    if (hit) existingId = hit.id;
  }

  if (existingId) {
    const patchRes = await fetch(
      `https://api.github.com/repos/${args.repo}/issues/comments/${existingId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ body }),
        signal: AbortSignal.timeout(15_000),
      },
    ).catch(() => null);
    if (patchRes && patchRes.ok) {
      console.log(`[builder] updated PR comment #${existingId}`);
      return;
    }
    console.warn(
      `[builder] PATCH comment ${existingId} failed (${patchRes?.status ?? "?"})`,
    );
  }

  const postRes = await fetch(apiBase, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (postRes && postRes.ok) {
    console.log(`[builder] posted preview comment on PR #${args.pr}`);
    return;
  }
  console.warn(
    `[builder] POST preview comment failed (${postRes?.status ?? "?"})`,
  );
}

async function patchBaseImageInDockerfile(
  dockerfilePath: string,
  baseImage: string,
): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const original = await readFile(dockerfilePath, "utf8");
  // Replace the ARG default with the literal base image, then drop the
  // `${BASE_IMAGE:-...}` indirection so flyctl never sees a --build-arg.
  const patched = original
    .replace(/^ARG BASE_IMAGE=.*$/m, `ARG BASE_IMAGE=${baseImage}`)
    .replace(/\$\{BASE_IMAGE:-[^}]+\}/g, baseImage)
    .replace(/\$\{BASE_IMAGE\}/g, baseImage);
  const { writeFile: wf } = await import("node:fs/promises");
  await wf(dockerfilePath, patched, "utf8");
}

async function pushPreviewImage(
  cwd: string,
  appName: string,
  imageTag: string,
  flyToken: string,
  baseImage: string | null,
): Promise<void> {
  const dockerfilePath = resolve(cwd, "Dockerfile.preview");
  if (!(await exists(dockerfilePath))) {
    const src = defaultDockerfilePath();
    await copyFile(src, dockerfilePath);
    console.log(
      `[builder] using bundled default Dockerfile.preview (${src.split("/").pop()})`,
    );
  } else {
    console.log("[builder] using repo Dockerfile.preview");
  }

  const tomlPath = resolve(cwd, "fly.toml");
  if (!(await exists(tomlPath))) {
    await writeFile(
      tomlPath,
      `app = "${appName}"\nprimary_region = "fra"\n\n[build]\n  dockerfile = "Dockerfile.preview"\n`,
      "utf8",
    );
  }

  // Build runs on the org's traditional remote builder app
  // (fly-builder-<org>). Its VM size is controlled with
  // `flyctl scale -a fly-builder-<org>` — set once at provision
  // time, every subsequent build inherits it. No --depot, so
  // Depot's auto-sized OOM-prone shared builder is bypassed.
  console.log(
    `[builder] pushing image to registry.fly.io/${appName}:${imageTag}`,
  );
  if (baseImage) {
    console.log(`[builder] inheriting from base image ${baseImage}`);
    // flyctl --remote-only + --build-arg has a docker-daemon-resolution
    // bug ('failed to parse daemon host'). Substitute the base image
    // into the Dockerfile directly so flyctl never sees a --build-arg.
    await patchBaseImageInDockerfile(
      resolve(cwd, "Dockerfile.preview"),
      baseImage,
    );
  } else {
    console.log("[builder] no base image found — full cold build");
  }
  let built = -1;
  const args = [
    "deploy",
    "--build-only",
    "--push",
    "--image-label",
    imageTag,
    "--app",
    appName,
    "--remote-only",
    "--depot=false",
    "--yes",
  ];
  for (let attempt = 0; attempt < 4; attempt++) {
    built = await run("flyctl", args, {
      cwd,
      // DOCKER_HOST with a parseable TCP form sidesteps flyctl's
      // "failed to parse daemon host unix:/// : missing hostname" bug
      // on the heartbeat + metadata-load paths. We set it on the spawn
      // env (not just the Dockerfile ENV) so it takes effect even if
      // the parent shell already has a different DOCKER_HOST.
      env: {
        FLY_API_TOKEN: flyToken,
        DOCKER_HOST: "tcp://127.0.0.1:2375",
        // Tell flyctl's heartbeat to give up quickly rather than retry.
        FLY_NO_DEPLOY_PROGRESS: "1",
      },
      timeoutMs:
        Number.parseInt(process.env.PREVIEW_BUILD_TIMEOUT_MS ?? "", 10) ||
        DEFAULT_BUILD_TIMEOUT_MS,
    });
    if (built === 0) break;
    if (attempt < 3) {
      console.log(
        `[builder] flyctl deploy attempt ${attempt + 1} failed; retrying in ${(attempt + 1) * 15}s...`,
      );
      await new Promise((r) => setTimeout(r, (attempt + 1) * 15_000));
    }
  }
  if (built !== 0) process.exit(3);
}

async function main() {
  const repo = required("REPO");
  const ref = required("REF");
  const appName = required("APP_NAME");
  const imageTag = required("IMAGE_TAG");
  const flyToken = required("FLY_API_TOKEN");
  const orgSlug = (process.env.FLY_ORG_SLUG ?? "personal").trim();
  const region = (process.env.FLY_REGION ?? "fra").trim();
  const githubToken = process.env.GITHUB_TOKEN?.trim() || "";

  const cwd = "/tmp/work";
  await mkdir(cwd, { recursive: true });

  try {
    // Run app + IP allocation in parallel with the clone. createApp is
    // idempotent on 422; allocateSharedIps swallows "already allocated".
    const flyPrep = (async () => {
      if (!(await appExists(appName, flyToken))) {
        console.log(`[builder] creating app ${appName}`);
        await createApp(appName, orgSlug, flyToken);
      }
      console.log(`[builder] allocating shared IPs`);
      await allocateSharedIps(appName, flyToken);
    })();

    await Promise.all([flyPrep, cloneRepo(repo, ref, cwd, githubToken)]);

    // Parse vault secrets ONCE — used both at build (.env.production.local)
    // and at runtime (preview machine env). Empty when no BUILD_ENV_JSON
    // was passed in, which is fine for projects without secrets.
    let vaultEnv: Record<string, string> = {};
    const buildEnvRaw = process.env.BUILD_ENV_JSON?.trim();
    if (buildEnvRaw) {
      try {
        vaultEnv = JSON.parse(buildEnvRaw) as Record<string, string>;
      } catch (err) {
        console.warn("[builder] BUILD_ENV_JSON parse failed:", err);
      }
    }
    const vaultKeys = Object.keys(vaultEnv);
    if (vaultKeys.length > 0) {
      const lines = vaultKeys.map(
        (k) => `${k}=${JSON.stringify(vaultEnv[k] ?? "")}`,
      );
      await writeFile(
        resolve(cwd, ".env.production.local"),
        lines.join("\n") + "\n",
        "utf8",
      );
      console.log(
        `[builder] wrote .env.production.local with ${vaultKeys.length} vars`,
      );
    }

    const ghcrOwner = process.env.MIRROR_TO_GHCR_OWNER?.trim();
    const isBaseBuild = appName.endsWith("-base");

    console.log(
      `[builder] inherit-probe ghcrOwner=${ghcrOwner ?? "<unset>"} isBaseBuild=${isBaseBuild}`,
    );

    // Image inheritance: if a base image exists on GHCR for this repo,
    // the PR Dockerfile FROMs it and skips deps install + cold compile.
    // Base builds themselves never inherit (they're the source).
    let baseImage: string | null = null;
    if (!isBaseBuild && ghcrOwner) {
      try {
        baseImage = await findBaseImage(repo, ghcrOwner);
        console.log(`[builder] inherit-probe result=${baseImage ?? "<null>"}`);
      } catch (err) {
        console.warn("[builder] inherit-probe threw:", err);
      }
    }

    await pushPreviewImage(cwd, appName, imageTag, flyToken, baseImage);

    // After a successful base build, mirror it to GHCR so future PR
    // builds can FROM it inside flyctl's --remote-only context.
    if (isBaseBuild && ghcrOwner && githubToken) {
      try {
        await mirrorBaseToGhcr(
          repo,
          appName,
          imageTag,
          ghcrOwner,
          githubToken,
          flyToken,
        );
      } catch (err) {
        console.warn("[builder] mirrorBaseToGhcr failed (non-fatal):", err);
      }
    }

    // Destroy any stale machines from prior PR sync, then boot the new one.
    const stale = await listMachines(appName, flyToken);
    if (stale.length > 0) {
      console.log(`[builder] destroying ${stale.length} stale machine(s)`);
      await Promise.all(
        stale.map((m) =>
          destroyMachine(appName, m.id, flyToken).catch((err) =>
            console.warn(`[builder] destroyMachine ${m.id} failed:`, err),
          ),
        ),
      );
    }

    const image = `registry.fly.io/${appName}:${imageTag}`;
    console.log(`[builder] creating preview machine from ${image}`);

    // Per-repo machine knobs forwarded by the dashboard (kody.config.json
    // fly.previews). Absent → createPreviewMachine applies its own default.
    const cpusRaw = Number.parseInt(process.env.PREVIEW_VM_CPUS ?? "", 10);
    const memRaw = Number.parseInt(process.env.PREVIEW_VM_MEMORY_MB ?? "", 10);
    const idleSuspend = process.env.PREVIEW_IDLE_SUSPEND
      ? process.env.PREVIEW_IDLE_SUSPEND === "1"
      : undefined;
    const healthCheck = process.env.PREVIEW_HEALTHCHECK
      ? process.env.PREVIEW_HEALTHCHECK === "1"
      : undefined;

    // Same vault secrets that were baked into the build are also
    // needed at runtime — SSR pages reading DATABASE_URL on each
    // request, e.g. Payload CMS.
    const machineId = await createPreviewMachine(
      {
        appName,
        region,
        image,
        // Doorman proxy runs on 8080; Next.js (and other apps) on 3000.
        internalPort: 3000,
        // Vault secrets (from BUILD_ENV_JSON) are app runtime env; also
        // thread the derived preview-verify key from the dashboard so the
        // doorman can validate access tickets without the raw master key.
        env: {
          ...vaultEnv,
          ...(process.env.KODY_PREVIEW_VERIFY_KEY
            ? { KODY_PREVIEW_VERIFY_KEY: process.env.KODY_PREVIEW_VERIFY_KEY }
            : {}),
          // Machine identity — set by the dashboard so the doorman in the
          // preview machine can bind tickets to this specific repo/pr and
          // reject tickets meant for a different machine.
          ...(process.env.KODY_REPO_CONTEXT
            ? { KODY_REPO_CONTEXT: process.env.KODY_REPO_CONTEXT }
            : {}),
          ...(process.env.KODY_PR ? { KODY_PR: process.env.KODY_PR } : {}),
        },
        ...(Number.isFinite(cpusRaw) && cpusRaw > 0 ? { cpus: cpusRaw } : {}),
        ...(Number.isFinite(memRaw) && memRaw > 0 ? { memoryMb: memRaw } : {}),
        ...(idleSuspend !== undefined ? { idleSuspend } : {}),
        ...(healthCheck !== undefined ? { healthCheck } : {}),
      },
      flyToken,
    );
    console.log(
      `[builder] done — preview machine ${machineId} at https://${appName}.fly.dev`,
    );

    // Post a preview-ready comment on the PR. Skipped on base rebuilds
    // (no PR) and when no token / PR_NUMBER was supplied. Idempotent —
    // updates a prior preview comment in place rather than spamming.
    const prRaw = process.env.PR_NUMBER?.trim();
    const prNumber = prRaw ? Number.parseInt(prRaw, 10) : NaN;
    if (!isBaseBuild && githubToken && Number.isFinite(prNumber)) {
      try {
        await postPreviewComment({
          repo,
          pr: prNumber,
          appName,
          token: githubToken,
          ref,
        });
      } catch (err) {
        console.warn("[builder] postPreviewComment failed (non-fatal):", err);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error("[builder] orchestration failed:", err);
    process.exit(4);
  }
}

main().catch((err) => {
  console.error("[builder] unexpected:", err);
  process.exit(1);
});
