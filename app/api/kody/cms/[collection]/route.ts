import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@dashboard/lib/auth";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { CmsConfigError } from "@dashboard/lib/cms/config";
import {
  CmsRuntimeError,
  createCmsDocument,
  listCmsDocuments,
  parseCmsListQuery,
} from "@dashboard/lib/cms/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ collection: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(
    headerAuth.owner,
    headerAuth.repo,
    headerAuth.token,
    headerAuth.storeRepoUrl,
    headerAuth.storeRef,
  );

  try {
    const { collection } = await params;
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const result = await listCmsDocuments(
      req,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      decodeURIComponent(collection),
      parseCmsListQuery(req),
    );
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleCmsError(error, "failed_to_list_cms_documents");
  } finally {
    clearGitHubContext();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ collection: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(
    headerAuth.owner,
    headerAuth.repo,
    headerAuth.token,
    headerAuth.storeRepoUrl,
    headerAuth.storeRef,
  );

  try {
    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) return actorResult;

    const { collection } = await params;
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const body = await readJsonBody(req);
    const document = await createCmsDocument(
      req,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      decodeURIComponent(collection),
      body,
    );

    return NextResponse.json(
      { document },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return handleCmsError(error, "failed_to_create_cms_document");
  } finally {
    clearGitHubContext();
  }
}

async function readJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CmsConfigError(["request body must be a JSON object"]);
  }
  return body as Record<string, unknown>;
}

function handleCmsError(error: unknown, fallback: string): NextResponse {
  if (error instanceof CmsConfigError || error instanceof CmsRuntimeError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status, headers: NO_STORE_HEADERS },
    );
  }

  const status = (error as { status?: number } | null)?.status;
  if (status === 401) {
    return NextResponse.json(
      { error: "github_token_expired" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (
    status === 403 ||
    String((error as Error)?.message ?? "").includes("rate limit")
  ) {
    return NextResponse.json(
      { error: "rate_limited", message: "GitHub API rate limit exceeded" },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  logger.error({ err: error }, "cms: list documents failed");
  return NextResponse.json(
    { error: fallback },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}
