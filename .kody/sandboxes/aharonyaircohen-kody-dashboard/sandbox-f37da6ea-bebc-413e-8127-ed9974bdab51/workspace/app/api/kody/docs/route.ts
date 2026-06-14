/**
 * @fileType api-endpoint
 * @domain docs
 * @pattern docs-api
 *
 * GET /api/kody/docs — Lists README.md and nested docs markdown from the connected repo.
 * GET /api/kody/docs?path=<path> — Returns content + metadata for a single doc.
 * POST /api/kody/docs — Creates a doc.
 * PATCH /api/kody/docs?path=<path> — Updates or renames a doc.
 * DELETE /api/kody/docs?path=<path> — Deletes a doc.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  getOctokit,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import {
  createDoc,
  deleteDoc,
  isAllowedDocPath,
  listDocs,
  normalizeDocPath,
  readDoc,
  updateDoc,
} from "@dashboard/lib/docs/file";

const MAX_DOC_CHARS = 1_000_000;

const DocPathSchema = z
  .string()
  .min(1)
  .max(220)
  .transform(normalizeDocPath)
  .refine(isAllowedDocPath, "invalid_doc_path");

const CreateDocSchema = z.object({
  path: DocPathSchema,
  content: z.string().max(MAX_DOC_CHARS).default(""),
});

const UpdateDocSchema = z
  .object({
    content: z.string().max(MAX_DOC_CHARS).optional(),
    newPath: DocPathSchema.optional(),
  })
  .refine((input) => input.content !== undefined || input.newPath, {
    message: "missing_doc_update",
  });

function errorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "invalid_doc_input", issues: error.issues },
      { status: 400 },
    );
  }

  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);
  if (message === "invalid_doc_path") {
    return NextResponse.json({ error: "invalid_doc_path" }, { status: 400 });
  }
  if (message === "doc_not_found") {
    return NextResponse.json({ error: "doc_not_found" }, { status: 404 });
  }
  if (message === "doc_already_exists") {
    return NextResponse.json({ error: "doc_already_exists" }, { status: 409 });
  }
  if (status === 401) {
    return NextResponse.json(
      { error: "github_token_expired" },
      { status: 401 },
    );
  }
  if (status === 403 || message.includes("rate limit")) {
    return NextResponse.json(
      { error: "rate_limited", message: "GitHub API rate limit exceeded" },
      { status: 429 },
    );
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

async function requireDocsContext(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  const owner = headerAuth?.owner ?? process.env.GITHUB_OWNER ?? "";
  const repo = headerAuth?.repo ?? process.env.GITHUB_REPO ?? "";
  if (!owner || !repo) {
    return NextResponse.json(
      { error: "missing_repo_context" },
      { status: 400 },
    );
  }

  return { octokit: getOctokit(), owner, repo };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await requireDocsContext(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const path = searchParams.get("path");

    if (path) {
      // Return a single doc
      const file = await readDoc(ctx.octokit, ctx.owner, ctx.repo, path);
      return NextResponse.json({
        name: file.name,
        path: file.path,
        content: file.content,
        htmlUrl: file.htmlUrl,
      });
    }

    // Return the manifest (list all docs)
    const manifest = await listDocs(ctx.octokit, ctx.owner, ctx.repo);
    return NextResponse.json({ files: manifest.files });
  } catch (error) {
    return errorResponse(error);
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await requireDocsContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const input = CreateDocSchema.parse(await req.json());
    const file = await createDoc(
      ctx.octokit,
      ctx.owner,
      ctx.repo,
      input.path,
      input.content,
    );
    return NextResponse.json({
      name: file.name,
      path: file.path,
      content: file.content,
      htmlUrl: file.htmlUrl,
    });
  } catch (error) {
    return errorResponse(error);
  } finally {
    clearGitHubContext();
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await requireDocsContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const path = DocPathSchema.parse(new URL(req.url).searchParams.get("path"));
    const input = UpdateDocSchema.parse(await req.json());
    const file = await updateDoc(ctx.octokit, ctx.owner, ctx.repo, path, input);
    return NextResponse.json({
      name: file.name,
      path: file.path,
      content: file.content,
      htmlUrl: file.htmlUrl,
    });
  } catch (error) {
    return errorResponse(error);
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await requireDocsContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const path = DocPathSchema.parse(new URL(req.url).searchParams.get("path"));
    await deleteDoc(ctx.octokit, ctx.owner, ctx.repo, path);
    return NextResponse.json({ success: true, path });
  } catch (error) {
    return errorResponse(error);
  } finally {
    clearGitHubContext();
  }
}
