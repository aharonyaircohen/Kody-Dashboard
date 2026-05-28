/**
 * Build orchestration.
 *
 * Flow per request:
 *   1. Clone <repo> at <ref> into /tmp/kody-build-<uuid>
 *   2. If the working tree has no Dockerfile.preview, copy the bundled
 *      default from the image so consumer repos stay zero-touch.
 *   3. Run `flyctl deploy --build-only --image-label <tag>` against the
 *      target Fly app, with FLY_API_TOKEN injected. Fly's hosted remote
 *      builder does the actual Docker build and pushes to its registry.
 *   4. Return the resulting image ref.
 *
 * The target Fly app passed in MUST exist beforehand — the dashboard
 * creates the per-PR app + allocates IPs before calling here. That keeps
 * "build" and "deploy" cleanly separated.
 */

import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface BuildRequest {
  /** owner/name */
  repo: string;
  /** Git ref to check out (branch, tag, or sha). */
  ref: string;
  /** Fly app name the image will be tagged under. Must already exist. */
  appName: string;
  /** Tag for the resulting image (defaults to a hash of repo+ref). */
  imageTag?: string;
  /** Fly token with push access to <appName>. */
  flyToken: string;
  /** Optional GitHub token to clone private repos. */
  githubToken?: string;
}

export interface BuildResult {
  image: string;
  durationMs: number;
}

const WORK_ROOT = "/tmp/kody-build";
const DEFAULT_DOCKERFILE = "/app/default-Dockerfile.preview";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function defaultTagFor(repo: string, ref: string): string {
  return createHash("sha256")
    .update(`${repo}@${ref}`)
    .digest("hex")
    .slice(0, 12);
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function build(req: BuildRequest): Promise<BuildResult> {
  const startedAt = Date.now();
  const id = randomUUID();
  const cwd = resolve(WORK_ROOT, id);
  await mkdir(cwd, { recursive: true });

  try {
    const cloneUrl = req.githubToken
      ? `https://x-access-token:${req.githubToken}@github.com/${req.repo}.git`
      : `https://github.com/${req.repo}.git`;

    const cloned = await run("git", [
      "clone",
      "--depth=1",
      "--branch",
      req.ref,
      cloneUrl,
      cwd,
    ]);
    if (cloned.code !== 0) {
      throw new Error(
        `git clone failed: ${cloned.stderr.slice(0, 500) || cloned.stdout.slice(0, 500)}`,
      );
    }

    // If the consumer repo ships its own Dockerfile.preview, use that.
    // Otherwise drop in the bundled default — that's what keeps consumer
    // repos zero-touch.
    const dockerfilePath = resolve(cwd, "Dockerfile.preview");
    if (!(await exists(dockerfilePath))) {
      await copyFile(DEFAULT_DOCKERFILE, dockerfilePath);
    }

    const tag = req.imageTag ?? defaultTagFor(req.repo, req.ref);
    const built = await run(
      "flyctl",
      [
        "deploy",
        "--build-only",
        "--dockerfile",
        "Dockerfile.preview",
        "--image-label",
        tag,
        "--app",
        req.appName,
        "--remote-only",
        "--yes",
      ],
      {
        cwd,
        env: { FLY_API_TOKEN: req.flyToken },
      },
    );
    if (built.code !== 0) {
      throw new Error(
        `flyctl build failed: ${built.stderr.slice(0, 1000) || built.stdout.slice(0, 1000)}`,
      );
    }

    return {
      image: `registry.fly.io/${req.appName}:${tag}`,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}
