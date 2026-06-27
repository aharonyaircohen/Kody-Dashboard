import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import {
  assertSchemaOperationAllowed,
  CmsConfigError,
  invalidateCmsConfigCache,
  loadCmsConfigFromState,
} from "@dashboard/lib/cms/config";
import {
  buildCmsModelFiles,
  sanitizeCmsModelCollectionPayload,
} from "@dashboard/lib/cms/model/server";
import { getCmsActorRole } from "@dashboard/lib/cms/roles";
import {
  CmsRuntimeError,
  listCmsCollections,
} from "@dashboard/lib/cms/service";
import { writeStateFiles } from "@dashboard/lib/state-repo";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function PATCH(req: NextRequest) {
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
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const existingConfig = await loadCmsConfigFromState(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const actorRole = await getCmsActorRole(
      req,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    if (existingConfig) {
      assertSchemaOperationAllowed(existingConfig, "edit", actorRole);
    } else if (actorRole !== "admin") {
      throw new CmsConfigError(["edit CMS schema is not allowed for viewer"], {
        code: "cms_forbidden",
        status: 403,
      });
    }

    const payload = await req.json().catch(() => ({}));
    const collection = sanitizeCmsModelCollectionPayload(payload, {
      existingCollections: existingConfig
        ? Object.values(existingConfig.collections)
        : [],
      originalName: originalNameFromPayload(payload),
    });
    const files = await buildCmsModelFiles({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      collection,
    });

    await writeStateFiles({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      files,
      message: `chore(cms): save ${collection.name} schema`,
    });
    invalidateCmsConfigCache(headerAuth.owner, headerAuth.repo);

    const cms = await listCmsCollections(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      actorRole,
    );
    return NextResponse.json(
      { cms, collection },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return handleModelError(error);
  } finally {
    clearGitHubContext();
  }
}

function originalNameFromPayload(payload: unknown): string | null | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "originalName")) {
    return undefined;
  }
  const value = (payload as { originalName?: unknown }).originalName;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function handleModelError(error: unknown): NextResponse {
  if (error instanceof CmsConfigError || error instanceof CmsRuntimeError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status, headers: NO_STORE_HEADERS },
    );
  }
  logger.error({ err: error }, "cms model update failed");
  return NextResponse.json(
    { error: "failed_to_update_cms_model" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}
