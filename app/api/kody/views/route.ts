/**
 * @fileType api-endpoint
 * @domain preview
 * @pattern repo-backed-static-views
 * @ai-summary POST uploads static resources into the configured Kody state repo
 * under `views/<view-id>/` and returns a dashboard-served view URL.
 */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import {
  deleteStateDirectory,
  resolveStateRepo,
  stateRepoPath,
} from "@dashboard/lib/state-repo";

export const runtime = "nodejs";

const VIEW_ROOT = "views";
const VIEW_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 50;
const MAX_LABEL = 48;

interface RepoViewUpload {
  originalName: string;
  path: string;
  file: File;
  raw: Buffer;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "view"}-${randomUUID().slice(0, 8)}`;
}

function sanitizeSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[/\\]+/g, "-")
      .replace(/^\.+$/, "")
      .replace(/^\.+/, "")
      .replace(/[^\w. -]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 120) || "file"
  );
}

function sanitizeRelativePath(value: string): string {
  const parts = value
    .replaceAll("\\", "/")
    .split("/")
    .map(sanitizeSegment)
    .filter(Boolean);
  return (parts.length > 0 ? parts : ["file"]).join("/");
}

function uniquePath(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : `${path.slice(0, slash + 1)}`;
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  let next = `${dir}${stem}-${index}${ext}`;
  while (used.has(next)) {
    index += 1;
    next = `${dir}${stem}-${index}${ext}`;
  }
  used.add(next);
  return next;
}

function isHtmlName(name: string): boolean {
  return /\.html?$/i.test(name);
}

function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name);
}

function looksLikeHtml(buf: Buffer): boolean {
  const head = buf.subarray(0, 512).toString("utf8").trim().toLowerCase();
  return /^<(!doctype html|html[\s>]|head[\s>]|body[\s>])/.test(head);
}

function pickEntryPath(uploads: RepoViewUpload[]): string {
  const index = uploads.find((upload) => /^index\.html?$/i.test(upload.path));
  if (index) return index.path;
  const first = uploads[0]!;
  return first.path;
}

async function commitFiles(input: {
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>;
  owner: string;
  repo: string;
  rootPath: string;
  files: Array<{ path: string; raw: Buffer }>;
  message: string;
}): Promise<{
  branch: string;
  commitSha: string;
  owner: string;
  repo: string;
  rootPath: string;
}> {
  const target = await resolveStateRepo(input.octokit, input.owner, input.repo);
  const repoInfo = await input.octokit.rest.repos.get({
    owner: target.owner,
    repo: target.repo,
  });
  const branch = repoInfo.data.default_branch;
  const ref = await input.octokit.rest.git.getRef({
    owner: target.owner,
    repo: target.repo,
    ref: `heads/${branch}`,
  });
  const baseSha = ref.data.object.sha;
  const baseCommit = await input.octokit.rest.git.getCommit({
    owner: target.owner,
    repo: target.repo,
    commit_sha: baseSha,
  });
  const blobs = await Promise.all(
    input.files.map(async (file) => {
      const blob = await input.octokit.rest.git.createBlob({
        owner: target.owner,
        repo: target.repo,
        content: file.raw.toString("base64"),
        encoding: "base64",
      });
      return { path: stateRepoPath(target, file.path), sha: blob.data.sha };
    }),
  );
  const tree = await input.octokit.rest.git.createTree({
    owner: target.owner,
    repo: target.repo,
    base_tree: baseCommit.data.tree.sha,
    tree: blobs.map((blob) => ({
      path: blob.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    })),
  });
  const commit = await input.octokit.rest.git.createCommit({
    owner: target.owner,
    repo: target.repo,
    message: input.message,
    tree: tree.data.sha,
    parents: [baseSha],
  });
  await input.octokit.rest.git.updateRef({
    owner: target.owner,
    repo: target.repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
  });
  return {
    branch,
    commitSha: commit.data.sha,
    owner: target.owner,
    repo: target.repo,
    rootPath: stateRepoPath(target, input.rootPath),
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const files = form
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: "too_many_files", message: `Too many files (${MAX_FILES} max)` },
      { status: 413 },
    );
  }

  const labelInput =
    typeof form.get("label") === "string"
      ? String(form.get("label")).trim().slice(0, MAX_LABEL)
      : "";
  const firstName = files[0]?.name || "view";
  const viewName =
    labelInput ||
    (files.length === 1
      ? firstName
      : `${firstName} + ${files.length - 1} ${files.length === 2 ? "file" : "files"}`);
  const viewId = slugify(viewName);
  const used = new Set<string>();
  const rawUploads = await Promise.all(
    files.map(async (file) => {
      const raw = Buffer.from(await file.arrayBuffer());
      const originalName = (file.name || "upload").trim();
      return { file, raw, originalName };
    }),
  );

  const empty = rawUploads.find((upload) => upload.raw.length === 0);
  if (empty) {
    return NextResponse.json(
      { error: "empty_file", message: `${empty.originalName} is empty` },
      { status: 400 },
    );
  }
  const tooLarge = rawUploads.find((upload) => upload.raw.length > MAX_BYTES);
  if (tooLarge) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: `${tooLarge.originalName} is too large (5 MB max)`,
      },
      { status: 413 },
    );
  }
  const totalBytes = rawUploads.reduce(
    (sum, upload) => sum + upload.raw.length,
    0,
  );
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: "files_too_large",
        message: "Files are too large together (10 MB max)",
      },
      { status: 413 },
    );
  }

  const uploads: RepoViewUpload[] = rawUploads.map((upload) => {
    const mime = upload.file.type.toLowerCase();
    const isSingleHtml =
      rawUploads.length === 1 &&
      !isPdfName(upload.originalName) &&
      (isHtmlName(upload.originalName) ||
        mime.startsWith("text/html") ||
        looksLikeHtml(upload.raw));
    const safePath = isSingleHtml
      ? "index.html"
      : sanitizeRelativePath(upload.originalName);
    return {
      ...upload,
      path: uniquePath(safePath, used),
    };
  });

  const repoRoot = `${VIEW_ROOT}/${viewId}`;
  const repoFiles = uploads.map((upload) => ({
    path: `${repoRoot}/${upload.path}`,
    raw: upload.raw,
  }));
  try {
    const {
      branch,
      owner: stateOwner,
      repo: stateRepo,
      rootPath,
    } = await commitFiles({
      octokit,
      owner: auth.owner,
      repo: auth.repo,
      rootPath: repoRoot,
      files: repoFiles,
      message: `chore(dashboard): add static view ${viewId}`,
    });
    const entryPath = pickEntryPath(uploads);
    return NextResponse.json(
      {
        id: viewId,
        name: viewName,
        url: `/api/kody/views/${viewId}/${entryPath}`,
        repoPath: repoRoot,
        files: uploads.map((upload) => upload.path),
        htmlUrl: `https://github.com/${stateOwner}/${stateRepo}/tree/${encodeURIComponent(
          branch,
        )}/${rootPath}`,
      },
      { status: 201 },
    );
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo, viewId },
      "views: upload failed",
    );
    return NextResponse.json(
      { error: "view_upload_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  const viewId = new URL(req.url).searchParams.get("view")?.trim() ?? "";
  if (!VIEW_ID_RE.test(viewId)) {
    return NextResponse.json({ error: "invalid_view" }, { status: 400 });
  }

  try {
    const result = await deleteStateDirectory({
      octokit,
      owner: auth.owner,
      repo: auth.repo,
      path: `${VIEW_ROOT}/${viewId}`,
      message: `chore(dashboard): remove static view ${viewId}`,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo, viewId },
      "views: delete failed",
    );
    return NextResponse.json(
      { error: "view_delete_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
