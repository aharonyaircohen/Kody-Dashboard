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
 *   GITHUB_TOKEN      optional, for private clones
 *   BUILD_ENV_JSON    optional JSON object of build-time secrets
 *                     (written as .env.production.local in the clone)
 *
 * Exit codes:
 *   0  success — preview machine is running
 *   1  bad / missing inputs
 *   2  clone failed
 *   3  flyctl build failed
 *   4  Fly orchestration failed
 */

import { spawn } from "node:child_process";
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

const DEFAULT_DOCKERFILE = "/app/default-Dockerfile.preview";

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
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<number> {
  return new Promise((resolveFn) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: "inherit",
    });
    child.on("close", (code) => resolveFn(code ?? -1));
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
    if ((await run("git", ["fetch", "--depth=1", "origin", ref], { cwd })) !== 0) {
      process.exit(2);
    }
    if ((await run("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd })) !== 0) {
      process.exit(2);
    }
  } else {
    if (
      (await run("git", ["clone", "--depth=1", "--branch", ref, cloneUrl, cwd])) !== 0
    ) {
      process.exit(2);
    }
  }
}

async function pushPreviewImage(
  cwd: string,
  appName: string,
  imageTag: string,
  flyToken: string,
): Promise<void> {
  const dockerfilePath = resolve(cwd, "Dockerfile.preview");
  if (!(await exists(dockerfilePath))) {
    await copyFile(DEFAULT_DOCKERFILE, dockerfilePath);
    console.log("[builder] using bundled default Dockerfile.preview");
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
  console.log(`[builder] pushing image to registry.fly.io/${appName}:${imageTag}`);
  const built = await run(
    "flyctl",
    [
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
    ],
    { cwd, env: { FLY_API_TOKEN: flyToken } },
  );
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

    // Materialize build-time secrets as .env.production.local in the
    // cloned repo BEFORE the docker build runs. Next.js / Vite / etc.
    // pick this file up automatically during `next build`. Quotes
    // around values handle spaces and most special chars.
    const buildEnvRaw = process.env.BUILD_ENV_JSON?.trim();
    if (buildEnvRaw) {
      try {
        const obj = JSON.parse(buildEnvRaw) as Record<string, string>;
        const keys = Object.keys(obj);
        if (keys.length > 0) {
          const lines = keys.map((k) => `${k}=${JSON.stringify(obj[k] ?? "")}`);
          await writeFile(
            resolve(cwd, ".env.production.local"),
            lines.join("\n") + "\n",
            "utf8",
          );
          console.log(`[builder] wrote .env.production.local with ${keys.length} vars`);
        }
      } catch (err) {
        console.warn("[builder] BUILD_ENV_JSON parse failed:", err);
      }
    }

    await pushPreviewImage(cwd, appName, imageTag, flyToken);

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
    const machineId = await createPreviewMachine(
      { appName, region, image, internalPort: 8080 },
      flyToken,
    );
    console.log(`[builder] done — preview machine ${machineId} at https://${appName}.fly.dev`);
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
