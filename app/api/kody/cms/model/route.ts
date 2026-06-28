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
  getCollection,
  invalidateCmsConfigCache,
  loadCmsConfigFromState,
  toPublicCmsConfig,
} from "@dashboard/lib/cms/config";
import {
  assertCmsModelResourceDeletable,
  buildDeleteCmsModelFiles,
  buildCmsModelFiles,
  sanitizeCmsModelCollectionPayload,
} from "@dashboard/lib/cms/model/server";
import { getCmsActorRole } from "@dashboard/lib/cms/roles";
import { CmsRuntimeError } from "@dashboard/lib/cms/service";
import { deleteStateFile, writeStateFiles } from "@dashboard/lib/state-repo";
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

    const savedConfig = await loadCmsConfigFromState(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      { cache: false },
    );
    if (!savedConfig) {
      throw new CmsConfigError(["CMS is not configured"], {
        code: "cms_not_configured",
        status: 404,
      });
    }
    const savedCollection = getCollection(savedConfig, collection.name);
    assertCmsModelSavePersisted(collection, savedCollection);
    const cms = toPublicCmsConfig(savedConfig, actorRole);
    return NextResponse.json(
      { cms, collection: savedCollection },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return handleModelError(error);
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(req: NextRequest) {
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
    if (!existingConfig) {
      throw new CmsConfigError(["CMS is not configured"], {
        code: "cms_not_configured",
        status: 404,
      });
    }
    assertSchemaOperationAllowed(existingConfig, "edit", actorRole);

    const payload = await req.json().catch(() => ({}));
    const name = resourceNameFromPayload(payload);
    assertCmsModelResourceDeletable(
      String(name ?? "").trim(),
      Object.values(existingConfig.collections),
    );
    const plan = await buildDeleteCmsModelFiles({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      name,
    });

    await writeStateFiles({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      files: plan.files,
      message: `chore(cms): delete ${plan.name} schema`,
    });
    if (plan.deleteFile) {
      await deleteStateFile({
        octokit,
        owner: headerAuth.owner,
        repo: headerAuth.repo,
        path: plan.deleteFile.path,
        sha: plan.deleteFile.sha,
        message: `chore(cms): delete ${plan.name} schema file`,
      });
    }
    invalidateCmsConfigCache(headerAuth.owner, headerAuth.repo);

    const nextCollections = { ...existingConfig.collections };
    delete nextCollections[plan.name];
    const cms = toPublicCmsConfig(
      { ...existingConfig, collections: nextCollections },
      actorRole,
    );
    return NextResponse.json(
      { cms, deleted: true },
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

function resourceNameFromPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  return (payload as { name?: unknown }).name;
}

function assertCmsModelSavePersisted(
  expected: ReturnType<typeof sanitizeCmsModelCollectionPayload>,
  actual: ReturnType<typeof sanitizeCmsModelCollectionPayload>,
): void {
  if (
    JSON.stringify(cmsModelSaveSignature(actual)) ===
    JSON.stringify(cmsModelSaveSignature(expected))
  ) {
    return;
  }

  throw new CmsRuntimeError(
    "cms_model_not_saved",
    "CMS model save did not persist. Please retry.",
    500,
  );
}

function cmsModelSaveSignature(
  collection: ReturnType<typeof sanitizeCmsModelCollectionPayload>,
) {
  return {
    name: collection.name,
    label: collection.label,
    sourceCollection: collection.source.collection ?? collection.name,
    fields: collection.fields.map((field) => ({
      name: field.name,
      label: field.label ?? "",
      type: field.type,
      required: Boolean(field.required),
      readOnly: Boolean(field.readOnly),
      hidden: Boolean(field.hidden),
      target: field.target ?? "",
      valueField: field.valueField ?? "",
      labelField: field.labelField ?? "",
      options: field.options ?? [],
    })),
  };
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
