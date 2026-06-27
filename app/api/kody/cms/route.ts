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
import { logger } from "@dashboard/lib/logger";
import {
  assertSchemaOperationAllowed,
  CmsConfigError,
  DEFAULT_CMS_PERMISSIONS,
  invalidateCmsConfigCache,
  loadCmsConfigFromState,
} from "@dashboard/lib/cms/config";
import {
  defaultCmsAdapterSettings,
  isValidCmsAdapterName,
} from "@dashboard/lib/cms/adapter-catalog";
import {
  CmsRuntimeError,
  listCmsCollections,
} from "@dashboard/lib/cms/service";
import {
  readStateText,
  writeStateFiles,
  writeStateText,
} from "@dashboard/lib/state-repo";
import { getCmsActorRole } from "@dashboard/lib/cms/roles";
import type {
  CmsCollectionOperations,
  CmsContentOperation,
  CmsPermissionsConfig,
  CmsRole,
} from "@dashboard/lib/cms/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
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

    const actorRole = await getCmsActorRole(
      req,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const cms = await listCmsCollections(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      actorRole,
    );
    return NextResponse.json({ cms }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleCmsError(error, "failed_to_load_cms");
  } finally {
    clearGitHubContext();
  }
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

    const payload = await req.json().catch(() => ({}));
    const name = readCmsName(payload, headerAuth.repo);
    const adapter = readCmsAdapter(payload);
    const existing = await readStateText(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      "cms/config.json",
    );
    if (existing) {
      return NextResponse.json(
        {
          error: "cms_already_configured",
          message: "CMS is already configured for this repo.",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const actorRole = await getCmsActorRole(
      req,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const cms = {
      configured: true as const,
      version: 1 as const,
      name,
      environment: "default",
      defaultAdapter: adapter,
      writePolicy: "read-only" as const,
      actorRole,
      permissions: DEFAULT_CMS_PERMISSIONS,
      collections: [],
    };

    await writeStateText({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      path: "cms/config.json",
      content: `${JSON.stringify(
        {
          version: 1,
          name,
          environment: "default",
          defaultAdapter: adapter,
          adapters: {
            [adapter]: defaultCmsAdapterSettings(adapter),
          },
          writePolicy: "read-only",
          collections: [],
        },
        null,
        2,
      )}\n`,
      message: "chore(cms): create CMS config",
    });
    invalidateCmsConfigCache(headerAuth.owner, headerAuth.repo);

    return NextResponse.json(
      { cms },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return handleCmsError(error, "failed_to_create_cms");
  } finally {
    clearGitHubContext();
  }
}

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

    const config = await loadCmsConfigFromState(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    if (!config) {
      throw new CmsConfigError(["CMS is not configured for this repo"], {
        code: "cms_not_configured",
        status: 404,
      });
    }

    const actorRole = await getCmsActorRole(
      req,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    assertSchemaOperationAllowed(config, "edit", actorRole);

    const rawPayload = await req.json().catch(() => ({}));
    const adapter = isCmsAdapterPatch(rawPayload)
      ? readRequiredCmsAdapter(rawPayload)
      : null;
    const files = adapter
      ? await buildCmsAdapterFiles(
          octokit,
          headerAuth.owner,
          headerAuth.repo,
          config.defaultAdapter,
          adapter,
        )
      : await buildCmsPermissionFiles(
          octokit,
          headerAuth.owner,
          headerAuth.repo,
          sanitizePermissionsPayload(rawPayload),
        );

    await writeStateFiles({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      files,
      message: adapter
        ? "chore(cms): switch CMS adapter"
        : "chore(cms): update CMS permissions",
    });

    invalidateCmsConfigCache(headerAuth.owner, headerAuth.repo);
    const cms = await listCmsCollections(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      actorRole,
    );
    return NextResponse.json({ cms }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleCmsError(error, "failed_to_update_cms_permissions");
  } finally {
    clearGitHubContext();
  }
}

function readCmsName(payload: unknown, repo: string): string {
  const fallback = `${repo} CMS`;
  if (!payload || typeof payload !== "object" || !("name" in payload)) {
    return fallback;
  }
  const name = String((payload as { name?: unknown }).name ?? "").trim();
  if (!name) return fallback;
  if (name.length > 120) {
    throw new CmsRuntimeError(
      "invalid_body",
      "name must be 120 characters or fewer",
      400,
    );
  }
  return name;
}

function readCmsAdapter(payload: unknown): string {
  const fallback = "mongodb";
  if (!payload || typeof payload !== "object" || !("adapter" in payload)) {
    return fallback;
  }
  const adapter = String((payload as { adapter?: unknown }).adapter ?? "")
    .trim()
    .toLowerCase();
  if (!adapter) return fallback;
  if (!isValidCmsAdapterName(adapter)) {
    throw new CmsRuntimeError("invalid_body", "adapter name is invalid", 400);
  }
  return adapter;
}

function readRequiredCmsAdapter(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("adapter" in payload)) {
    throw new CmsRuntimeError("invalid_body", "adapter is required", 400);
  }
  const adapter = String((payload as { adapter?: unknown }).adapter ?? "")
    .trim()
    .toLowerCase();
  if (!adapter) {
    throw new CmsRuntimeError("invalid_body", "adapter is required", 400);
  }
  if (!isValidCmsAdapterName(adapter)) {
    throw new CmsRuntimeError("invalid_body", "adapter name is invalid", 400);
  }
  return adapter;
}

function isCmsAdapterPatch(payload: unknown): boolean {
  return Boolean(
    payload && typeof payload === "object" && "adapter" in payload,
  );
}

const CMS_ROLES = new Set<CmsRole>(["viewer", "editor", "admin"]);
const CONTENT_PERMISSION_OPERATIONS: CmsContentOperation[] = [
  "list",
  "get",
  "search",
  "create",
  "update",
  "delete",
];
const CMS_WRITE_OPERATIONS = ["create", "update", "delete"] as const;
type CmsWriteOperation = (typeof CMS_WRITE_OPERATIONS)[number];
type CmsWriteOperationsPatch = Pick<CmsCollectionOperations, CmsWriteOperation>;

interface CmsPermissionsPatch {
  permissions?: CmsPermissionsConfig;
  collections: Array<{
    name: string;
    permissions: CmsPermissionsConfig;
    operations?: CmsWriteOperationsPatch;
  }>;
}

function sanitizePermissionsPayload(input: unknown): CmsPermissionsPatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CmsRuntimeError(
      "invalid_body",
      "request body must be an object",
      400,
    );
  }

  const body = input as Record<string, unknown>;
  return {
    permissions: sanitizePermissions(body.permissions),
    collections: Array.isArray(body.collections)
      ? body.collections.map(sanitizeCollectionPermissionPatch)
      : [],
  };
}

function sanitizeCollectionPermissionPatch(input: unknown): {
  name: string;
  permissions: CmsPermissionsConfig;
  operations?: CmsWriteOperationsPatch;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CmsRuntimeError(
      "invalid_body",
      "collection permission must be an object",
      400,
    );
  }

  const item = input as Record<string, unknown>;
  const name = String(item.name ?? "").trim();
  if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new CmsRuntimeError(
      "invalid_body",
      "collection name is invalid",
      400,
    );
  }

  return {
    name,
    permissions: sanitizePermissions(item.permissions) ?? {},
    operations: sanitizeWriteOperations(item.operations),
  };
}

function sanitizePermissions(input: unknown): CmsPermissionsConfig | undefined {
  if (input == null) return undefined;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new CmsRuntimeError(
      "invalid_body",
      "permissions must be an object",
      400,
    );
  }

  const value = input as Record<string, unknown>;
  return {
    content: sanitizeRoleMap(value.content, CONTENT_PERMISSION_OPERATIONS),
    schema: sanitizeRoleMap(value.schema, ["generate", "refresh", "edit"]),
  };
}

function sanitizeRoleMap<T extends string>(
  input: unknown,
  operations: readonly T[],
): Partial<Record<T, CmsRole[]>> | undefined {
  if (input == null) return undefined;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new CmsRuntimeError(
      "invalid_body",
      "permission role map must be an object",
      400,
    );
  }

  const raw = input as Record<string, unknown>;
  const result: Partial<Record<T, CmsRole[]>> = {};

  for (const operation of operations) {
    if (!(operation in raw)) continue;
    result[operation] = sanitizeRoles(raw[operation]);
  }

  return result;
}

function sanitizeRoles(input: unknown): CmsRole[] {
  if (!Array.isArray(input)) {
    throw new CmsRuntimeError(
      "invalid_body",
      "permission roles must be an array",
      400,
    );
  }

  const roles: CmsRole[] = [];
  for (const role of input) {
    if (!CMS_ROLES.has(role as CmsRole)) {
      throw new CmsRuntimeError(
        "invalid_body",
        `invalid CMS role: ${String(role)}`,
        400,
      );
    }
    if (!roles.includes(role as CmsRole)) roles.push(role as CmsRole);
  }

  if (!roles.includes("admin")) roles.push("admin");
  return roles;
}

function sanitizeWriteOperations(
  input: unknown,
): CmsWriteOperationsPatch | undefined {
  if (input == null) return undefined;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new CmsRuntimeError(
      "invalid_body",
      "collection operations must be an object",
      400,
    );
  }

  const raw = input as Record<string, unknown>;
  const result = {} as CmsWriteOperationsPatch;
  for (const operation of CMS_WRITE_OPERATIONS) {
    if (!(operation in raw)) continue;
    if (typeof raw[operation] !== "boolean") {
      throw new CmsRuntimeError(
        "invalid_body",
        `collection operation ${operation} must be boolean`,
        400,
      );
    }
    result[operation] = raw[operation];
  }
  return result;
}

async function buildCmsPermissionFiles(
  octokit: Awaited<ReturnType<typeof getUserOctokit>>,
  owner: string,
  repo: string,
  patch: CmsPermissionsPatch,
) {
  if (!octokit)
    throw new CmsRuntimeError("no_user_token", "No user token", 401);

  const configFile = await readStateText(
    octokit,
    owner,
    repo,
    "cms/config.json",
  );
  if (!configFile) {
    throw new CmsConfigError(["missing state file: cms/config.json"], {
      code: "cms_not_configured",
      status: 404,
    });
  }

  const root = parseJsonRecord(configFile.content, "cms/config.json");
  if (patch.permissions) root.permissions = patch.permissions;

  const collectionPatchByName = new Map(
    patch.collections.map((collection) => [collection.name, collection]),
  );
  const files = [
    { path: "cms/config.json", content: `${JSON.stringify(root, null, 2)}\n` },
  ];

  if (collectionPatchByName.size === 0) return files;

  const rawCollections = root.collections;
  if (Array.isArray(rawCollections)) {
    for (let index = 0; index < rawCollections.length; index += 1) {
      const entry = rawCollections[index];
      if (typeof entry === "string") {
        const path = `cms/${entry}`;
        const file = await readStateText(octokit, owner, repo, path);
        if (!file) continue;
        const collection = parseJsonRecord(file.content, path);
        const name = String(collection.name ?? "");
        const collectionPatch = collectionPatchByName.get(name);
        if (!collectionPatch) continue;
        applyCollectionPatch(collection, collectionPatch);
        files.push({
          path,
          content: `${JSON.stringify(collection, null, 2)}\n`,
        });
        continue;
      }

      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const collection = entry as Record<string, unknown>;
        const name = String(collection.name ?? "");
        const collectionPatch = collectionPatchByName.get(name);
        if (collectionPatch) applyCollectionPatch(collection, collectionPatch);
      }
    }
    files[0] = {
      path: "cms/config.json",
      content: `${JSON.stringify(root, null, 2)}\n`,
    };
    return files;
  }

  if (rawCollections && typeof rawCollections === "object") {
    for (const [name, value] of Object.entries(rawCollections)) {
      const collectionPatch = collectionPatchByName.get(name);
      if (
        collectionPatch &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        applyCollectionPatch(value as Record<string, unknown>, collectionPatch);
      }
    }
    files[0] = {
      path: "cms/config.json",
      content: `${JSON.stringify(root, null, 2)}\n`,
    };
  }

  return files;
}

async function buildCmsAdapterFiles(
  octokit: Awaited<ReturnType<typeof getUserOctokit>>,
  owner: string,
  repo: string,
  previousDefaultAdapter: string | undefined,
  adapter: string,
) {
  if (!octokit)
    throw new CmsRuntimeError("no_user_token", "No user token", 401);

  const configFile = await readStateText(
    octokit,
    owner,
    repo,
    "cms/config.json",
  );
  if (!configFile) {
    throw new CmsConfigError(["missing state file: cms/config.json"], {
      code: "cms_not_configured",
      status: 404,
    });
  }

  const root = parseJsonRecord(configFile.content, "cms/config.json");
  const oldDefault =
    typeof root.defaultAdapter === "string" && root.defaultAdapter.trim()
      ? root.defaultAdapter.trim()
      : previousDefaultAdapter;
  root.defaultAdapter = adapter;

  const adapters =
    root.adapters &&
    typeof root.adapters === "object" &&
    !Array.isArray(root.adapters)
      ? { ...(root.adapters as Record<string, unknown>) }
      : {};
  if (
    !adapters[adapter] ||
    typeof adapters[adapter] !== "object" ||
    Array.isArray(adapters[adapter])
  ) {
    adapters[adapter] = defaultCmsAdapterSettings(adapter);
  }
  root.adapters = adapters;

  const files = [
    { path: "cms/config.json", content: `${JSON.stringify(root, null, 2)}\n` },
  ];

  await applyAdapterToDefaultCollections(
    octokit,
    owner,
    repo,
    root,
    oldDefault,
    adapter,
    files,
  );
  files[0] = {
    path: "cms/config.json",
    content: `${JSON.stringify(root, null, 2)}\n`,
  };
  return files;
}

async function applyAdapterToDefaultCollections(
  octokit: Awaited<ReturnType<typeof getUserOctokit>>,
  owner: string,
  repo: string,
  root: Record<string, unknown>,
  oldDefault: string | undefined,
  adapter: string,
  files: Array<{ path: string; content: string }>,
) {
  if (!octokit) return;
  const rawCollections = root.collections;

  if (Array.isArray(rawCollections)) {
    for (let index = 0; index < rawCollections.length; index += 1) {
      const entry = rawCollections[index];
      if (typeof entry === "string") {
        const path = `cms/${entry}`;
        const file = await readStateText(octokit, owner, repo, path);
        if (!file) continue;
        const collection = parseJsonRecord(file.content, path);
        if (!shouldSwitchCollectionAdapter(collection, oldDefault)) continue;
        collection.adapter = adapter;
        files.push({
          path,
          content: `${JSON.stringify(collection, null, 2)}\n`,
        });
        continue;
      }

      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const collection = entry as Record<string, unknown>;
        if (shouldSwitchCollectionAdapter(collection, oldDefault)) {
          collection.adapter = adapter;
        }
      }
    }
    return;
  }

  if (rawCollections && typeof rawCollections === "object") {
    for (const value of Object.values(rawCollections)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const collection = value as Record<string, unknown>;
        if (shouldSwitchCollectionAdapter(collection, oldDefault)) {
          collection.adapter = adapter;
        }
      }
    }
  }
}

function shouldSwitchCollectionAdapter(
  collection: Record<string, unknown>,
  oldDefault: string | undefined,
): boolean {
  const current =
    typeof collection.adapter === "string" ? collection.adapter.trim() : "";
  return !current || Boolean(oldDefault && current === oldDefault);
}

function applyCollectionPatch(
  collection: Record<string, unknown>,
  patch: CmsPermissionsPatch["collections"][number],
) {
  collection.permissions = patch.permissions;
  if (!patch.operations) return;

  const existingOperations =
    collection.operations &&
    typeof collection.operations === "object" &&
    !Array.isArray(collection.operations)
      ? (collection.operations as Record<string, unknown>)
      : {};
  collection.operations = {
    ...existingOperations,
    ...patch.operations,
  };
}

function parseJsonRecord(
  content: string,
  path: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // handled below
  }
  throw new CmsRuntimeError(
    "invalid_cms_config",
    `${path} is not valid JSON`,
    400,
  );
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

  logger.error({ err: error }, "cms: request failed");
  return NextResponse.json(
    { error: fallback },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}
