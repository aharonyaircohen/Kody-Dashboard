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
 * Build caching: Fly's Depot builder caches at org scope by default
 * (--depot-scope=org), so dep + .next/cache layers persist across all
 * builds in the org. No per-build configuration needed.
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
  // `git clone --depth=1 --branch <ref>` only works for branch/tag names.
  // The dashboard webhook passes `head.sha` (a commit SHA) on PR sync,
  // and SHAs need a two-step approach: shallow-clone the default branch
  // first, then fetch + checkout the SHA explicitly.
  const looksLikeSha = /^[0-9a-f]{7,40}$/i.test(ref);
  if (looksLikeSha) {
    const cloned = await run("git", ["clone", "--depth=1", cloneUrl, cwd]);
    if (cloned !== 0) process.exit(2);
    const fetched = await run(
      "git",
      ["fetch", "--depth=1", "origin", ref],
      { cwd },
    );
    if (fetched !== 0) process.exit(2);
    const checkedOut = await run(
      "git",
      ["checkout", "--detach", "FETCH_HEAD"],
      { cwd },
    );
    if (checkedOut !== 0) process.exit(2);
  } else {
    const cloned = await run("git", [
      "clone",
      "--depth=1",
      "--branch",
      ref,
      cloneUrl,
      cwd,
    ]);
    if (cloned !== 0) process.exit(2);
  }

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
  // Fly's Depot remote builder caches at org scope by default
  // (--depot-scope=org), so dep + .next/cache layers persist automatically
  // across builds — even across different per-PR apps. No explicit cache
  // flags needed.
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
      "--depot=true",
      "--depot-scope=org",
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
