import { NextRequest, NextResponse } from "next/server";
import type { Octokit } from "@octokit/rest";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import {
  assertSchemaOperationAllowed,
  CmsConfigError,
  invalidateCmsConfigCache,
  loadCmsConfigFromState,
} from "@dashboard/lib/cms/config";
import { generateMongoCmsSchemaFiles } from "@dashboard/lib/cms/schema/mongodb";
import {
  CmsRuntimeError,
  listCmsCollections,
} from "@dashboard/lib/cms/service";
import { readStateText, writeStateFiles } from "@dashboard/lib/state-repo";
import { getSecret } from "@dashboard/lib/vault/get-secret";
import { getCmsActorRole } from "@dashboard/lib/cms/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const CMS_DATABASE_URL_SECRET = "DATABASE_URL";
const DEFAULT_SCHEMA_SAMPLE_SIZE = 100;

interface GenerateSchemaPayload {
  adapter: "mongodb";
  databaseUriSecret: string;
  environment: string;
  name?: string;
  refresh: boolean;
  sampleSize: number;
  skipCollections: string[];
}

export async function POST(req: NextRequest) {
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

    const payload = parseGenerateSchemaPayload(
      await req.json().catch(() => ({})),
      headerAuth.repo,
    );
    const actorRole = await getCmsActorRole(
      req,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const currentConfig = await loadCmsConfigFromState(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    if (currentConfig) {
      assertSchemaOperationAllowed(
        currentConfig,
        payload.refresh ? "refresh" : "generate",
        actorRole,
      );
    } else if (actorRole !== "admin") {
      throw new CmsConfigError(
        ["generate CMS schema is not allowed for viewer"],
        {
          code: "cms_forbidden",
          status: 403,
        },
      );
    }
    const schemaAlreadyHasCollections = await cmsSchemaHasCollections(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    if (schemaAlreadyHasCollections && !payload.refresh) {
      return NextResponse.json(
        {
          error: "cms_schema_exists",
          message:
            "CMS schema already has collections. Use refresh to update it.",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const uri = await getSecret(CMS_DATABASE_URL_SECRET, { req });
    if (!uri) {
      return NextResponse.json(
        {
          error: "secret_not_configured",
          message: `Secret "${CMS_DATABASE_URL_SECRET}" is not configured.`,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const generated = await generateMongoCmsSchemaFiles({
      uri,
      databaseUriSecret: CMS_DATABASE_URL_SECRET,
      repoName: headerAuth.repo,
      cmsName: payload.name ?? `${headerAuth.repo} CMS`,
      environment: payload.environment,
      sampleSize: payload.sampleSize,
      skipCollections: payload.skipCollections,
    });
    if (generated.collectionCount < 1) {
      throw new CmsRuntimeError(
        "cms_schema_empty",
        `No MongoDB collections found from ${CMS_DATABASE_URL_SECRET}.`,
        400,
      );
    }

    await writeStateFiles({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      files: generated.files,
      message: payload.refresh
        ? "chore(cms): update CMS schema"
        : "chore(cms): generate CMS schema",
    });
    invalidateCmsConfigCache(headerAuth.owner, headerAuth.repo);

    const cms = await listCmsCollections(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      actorRole,
    );

    return NextResponse.json(
      {
        cms,
        generated: {
          collections: generated.collectionCount,
          refreshed: payload.refresh,
        },
      },
      { status: payload.refresh ? 200 : 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return handleSchemaError(error);
  } finally {
    clearGitHubContext();
  }
}

function parseGenerateSchemaPayload(
  input: unknown,
  repo: string,
): GenerateSchemaPayload {
  const body =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const adapter = stringValue(body.adapter) ?? "mongodb";
  if (adapter !== "mongodb") {
    throw new CmsRuntimeError(
      "invalid_body",
      "Only MongoDB schema generation is currently supported.",
      400,
    );
  }

  return {
    adapter: "mongodb",
    databaseUriSecret: CMS_DATABASE_URL_SECRET,
    environment: "default",
    name: stringValue(body.name) ?? `${repo} CMS`,
    refresh: body.refresh === true,
    sampleSize: DEFAULT_SCHEMA_SAMPLE_SIZE,
    skipCollections: [],
  };
}

async function cmsSchemaHasCollections(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<boolean> {
  const file = await readStateText(octokit, owner, repo, "cms/config.json");
  if (!file) return false;

  let config: unknown;
  try {
    config = JSON.parse(file.content);
  } catch {
    throw new CmsRuntimeError(
      "invalid_cms_config",
      "cms/config.json is not valid JSON.",
      400,
    );
  }

  if (!isRecord(config)) return false;
  const collections = config.collections;
  if (Array.isArray(collections)) return collections.length > 0;
  if (isRecord(collections)) return Object.keys(collections).length > 0;
  return false;
}

function handleSchemaError(error: unknown): NextResponse {
  if (error instanceof CmsConfigError || error instanceof CmsRuntimeError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status, headers: NO_STORE_HEADERS },
    );
  }

  logger.error({ err: error }, "cms: schema generation failed");
  return NextResponse.json(
    { error: "failed_to_generate_cms_schema" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
