/**
 * One-shot CLI builder.
 *
 * Runs as a per-build Fly Machine, NOT a long-lived service. The
 * dashboard spawns a machine from the image this CLI lives in, passes
 * everything via env vars, and waits for the machine to exit. No HTTP
 * layer, no auth dance, no edge-proxy timeouts.
 *
 * Required env:
 *   REPO              owner/name
 *   REF               branch or sha
 *   APP_NAME          Fly app to push the image into (must exist)
 *   IMAGE_TAG         tag for the built image
 *   FLY_API_TOKEN     for flyctl
 *   GITHUB_TOKEN      optional, for private clones
 *
 * Exit codes:
 *   0   success — image pushed to registry.fly.io/<APP_NAME>:<IMAGE_TAG>
 *   1   bad / missing inputs
 *   2   clone failed
 *   3   flyctl build failed
 */

import { spawn } from "node:child_process";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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

async function main() {
  const repo = required("REPO");
  const ref = required("REF");
  const appName = required("APP_NAME");
  const imageTag = required("IMAGE_TAG");
  const flyToken = required("FLY_API_TOKEN");
  const githubToken = process.env.GITHUB_TOKEN?.trim() || "";

  const cwd = "/tmp/work";
  await mkdir(cwd, { recursive: true });

  const cloneUrl = githubToken
    ? `https://x-access-token:${githubToken}@github.com/${repo}.git`
    : `https://github.com/${repo}.git`;

  console.log(`[builder] cloning ${repo}@${ref}`);
  const cloned = await run("git", [
    "clone",
    "--depth=1",
    "--branch",
    ref,
    cloneUrl,
    cwd,
  ]);
  if (cloned !== 0) process.exit(2);

  const dockerfilePath = resolve(cwd, "Dockerfile.preview");
  if (!(await exists(dockerfilePath))) {
    await copyFile(DEFAULT_DOCKERFILE, dockerfilePath);
    console.log("[builder] using bundled default Dockerfile.preview");
  } else {
    console.log("[builder] using repo Dockerfile.preview");
  }

  // flyctl deploy --build-only needs a fly.toml.
  const tomlPath = resolve(cwd, "fly.toml");
  if (!(await exists(tomlPath))) {
    await writeFile(
      tomlPath,
      `app = "${appName}"\nprimary_region = "fra"\n\n[build]\n  dockerfile = "Dockerfile.preview"\n`,
      "utf8",
    );
  }

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
      "--yes",
    ],
    { cwd, env: { FLY_API_TOKEN: flyToken } },
  );
  if (built !== 0) process.exit(3);

  console.log(`[builder] done: registry.fly.io/${appName}:${imageTag}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[builder] unexpected:", err);
  process.exit(1);
});
