import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

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
import {
  CmsConfigError,
  invalidateCmsConfigCache,
} from "@dashboard/lib/cms/config";
import {
  CmsRuntimeError,
  listCmsCollections,
} from "@dashboard/lib/cms/service";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function trimmed<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    schema,
  );
}

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}, z.string().max(120).optional());

const cmsSetupSchema = z.object({
  name: trimmed(z.string().min(1).max(120)).default("CMS"),
  databaseUriSecret: trimmed(
    z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Z][A-Z0-9_]*$/, {
        message: "Use an env secret name like DATABASE_URL.",
      }),
  ),
  databaseName: optionalTrimmedString,
  collectionName: trimmed(
    z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_.-]+$/, {
        message: "Use only letters, numbers, dots, dashes, or underscores.",
      }),
  ),
  collectionLabel: optionalTrimmedString,
  idField: trimmed(z.string().min(1).max(80)).default("_id"),
  titleField: trimmed(z.string().min(1).max(80)).default("title"),
});

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

    const cms = await listCmsCollections(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
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
    const payload = await req.json().catch(() => null);
    const parsed = cmsSetupSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "invalid_body",
          message: formatZodIssues(parsed.error.issues),
          issues: parsed.error.issues,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) return actorResult;

    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const existingConfig = await readStateText(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      "cms/config.json",
    );
    if (existingConfig) {
      return NextResponse.json(
        {
          error: "cms_already_configured",
          message: "CMS is already configured for this repo.",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const files = buildCmsSetupFiles(parsed.data);
    for (const file of files) {
      await writeStateText({
        octokit,
        owner: headerAuth.owner,
        repo: headerAuth.repo,
        path: file.path,
        content: `${JSON.stringify(file.content, null, 2)}\n`,
        message: `chore(cms): Configure ${parsed.data.collectionName}`,
      });
    }

    invalidateCmsConfigCache(headerAuth.owner, headerAuth.repo);
    const cms = await listCmsCollections(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    return NextResponse.json(
      { cms },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return handleCmsError(error, "failed_to_configure_cms");
  } finally {
    clearGitHubContext();
  }
}

function buildCmsSetupFiles(input: z.infer<typeof cmsSetupSchema>) {
  const collectionPath = `collections/${input.collectionName}.json`;
  const collectionLabel = input.collectionLabel?.trim() || input.collectionName;
  const fields = uniqueFields([
    { name: input.idField, type: "id", label: "ID", readOnly: true },
    { name: input.titleField, type: "text", label: "Title" },
  ]);

  return [
    {
      path: "cms/environments/dev.json",
      content: {
        name: "dev",
        adapter: "mongodb",
        databaseUriSecret: input.databaseUriSecret,
        ...(input.databaseName ? { databaseName: input.databaseName } : {}),
        writePolicy: "read-only",
      },
    },
    {
      path: `cms/${collectionPath}`,
      content: {
        name: input.collectionName,
        label: collectionLabel,
        adapter: "mongodb",
        source: {
          collection: input.collectionName,
          idField: input.idField,
        },
        titleField: input.titleField,
        searchFields:
          input.titleField === input.idField ? [] : [input.titleField],
        operations: {
          list: true,
          get: true,
          search: true,
          create: false,
          update: false,
          delete: false,
        },
        fields,
        views: {
          list: {
            fields: [
              { name: input.titleField, role: "primary", width: "fill" },
            ],
          },
          detail: {
            fields: fields.map((field) => ({ name: String(field.name) })),
          },
          form: {
            fields: fields
              .filter((field) => field.name !== input.idField)
              .map((field) => ({ name: String(field.name) })),
          },
        },
        filters:
          input.titleField === input.idField
            ? []
            : [{ field: input.titleField, operators: ["contains", "equals"] }],
        defaultSort: [],
      },
    },
    {
      path: "cms/config.json",
      content: {
        version: 1,
        name: input.name,
        environment: "dev",
        environmentFile: "environments/dev.json",
        defaultAdapter: "mongodb",
        writePolicy: "read-only",
        collections: [collectionPath],
      },
    },
  ];
}

function uniqueFields(fields: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const name = String(field.name ?? "");
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  const issue = issues[0];
  if (!issue) return "Invalid CMS setup form.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
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
