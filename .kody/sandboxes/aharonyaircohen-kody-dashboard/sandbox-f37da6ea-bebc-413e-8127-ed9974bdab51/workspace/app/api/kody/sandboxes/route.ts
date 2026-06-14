/**
 * @fileType api-endpoint
 * @domain sandboxes
 * @pattern local-sandbox-list-create
 *
 * GET/POST local dev sandbox profiles for the chat terminal.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import {
  createLocalSandbox,
  listLocalSandboxes,
  saveLocalSandboxSnapshot,
  type LocalSandbox,
} from "@dashboard/lib/sandboxes/local-sandboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1).max(80).optional(),
  runtime: z.enum(["local", "github-actions"]).optional(),
  sourceSandboxId: z.string().min(1).max(80).optional(),
});

function publicSandbox(sandbox: Awaited<ReturnType<typeof createLocalSandbox>>) {
  return {
    id: sandbox.id,
    name: sandbox.name,
    runtime: sandbox.runtime,
    scope: sandbox.scope,
    createdAt: sandbox.createdAt,
    updatedAt: sandbox.updatedAt,
    snapshotUpdatedAt: sandbox.snapshotUpdatedAt ?? null,
  };
}

async function getExistingFileSha(
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>,
  owner: string,
  repo: string,
  path: string,
): Promise<string | undefined> {
  try {
    const res = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: "main",
    });
    return !Array.isArray(res.data) && res.data.type === "file"
      ? res.data.sha
      : undefined;
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      err.status === 404
    ) {
      return undefined;
    }
    throw err;
  }
}

async function publishGitHubActionsSandboxSnapshot(
  req: NextRequest,
  auth: NonNullable<ReturnType<typeof getRequestAuth>>,
  sandbox: LocalSandbox,
): Promise<void> {
  const octokit = await getUserOctokit(req);
  if (!octokit) throw new Error("No GitHub token available");
  const path = `.kody/sandboxes/${sandbox.scope}/${sandbox.id}/snapshot.tar.gz.enc`;
  const content = await readFile(sandbox.snapshotPath, "base64");
  const sha = await getExistingFileSha(octokit, auth.owner, auth.repo, path);
  await octokit.repos.createOrUpdateFileContents({
    owner: auth.owner,
    repo: auth.repo,
    path,
    message: `chore(kody): save sandbox ${sandbox.id} [skip ci]`,
    content,
    branch: "main",
    ...(sha ? { sha } : {}),
  });
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const sandboxes = await listLocalSandboxes(auth);
  return NextResponse.json({ ok: true, sandboxes: sandboxes.map(publicSandbox) });
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }
  try {
    let sandbox = await createLocalSandbox(auth, parsed.data);
    if (sandbox.runtime === "github-actions") {
      sandbox = await saveLocalSandboxSnapshot(auth, sandbox.id);
      await publishGitHubActionsSandboxSnapshot(req, auth, sandbox);
    }
    return NextResponse.json({ ok: true, sandbox: publicSandbox(sandbox) });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create sandbox";
    return NextResponse.json(
      { error: "sandbox_create_failed", message },
      { status: 500 },
    );
  }
}
