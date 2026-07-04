/**
 * @fileType api-endpoint
 * @domain view-renderers
 * @pattern state-repo-crud-api
 * @ai-summary Lists and creates user-managed renderer definitions stored under
 *   `views/renderers/*.json` in the Kody state repo.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@dashboard/lib/auth";
import { recordAudit } from "@dashboard/lib/activity/audit";
import {
  isValidViewRendererSlug,
  listViewRendererDefinitionFiles,
  parseViewRendererDefinition,
  readViewRendererDefinitionFile,
  serializeViewRendererDefinition,
  writeViewRendererDefinitionFile,
  type ViewRendererDefinition,
} from "@dashboard/lib/view-renderers/renderers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const saveSchema = z.object({
  definition: z.string().min(2).max(20_000),
  actorLogin: z.string().optional(),
});

function requireRepo(req: NextRequest) {
  const auth = getRequestAuth(req);
  if (!auth) {
    return {
      response: NextResponse.json(
        { error: "missing_repo_context" },
        { status: 401, headers: NO_STORE_HEADERS },
      ),
    };
  }
  return { auth };
}

function toRow(definition: ViewRendererDefinition, htmlUrl = "") {
  return {
    slug: definition.slug,
    name: definition.name,
    description: definition.description ?? "",
    purpose: definition.purpose,
    rule: definition.rule ?? "",
    data: definition.data ?? {},
    defaults: definition.defaults ?? {},
    type: definition.type,
    ui: definition.ui,
    source: "repo" as const,
    htmlUrl,
    definition: serializeViewRendererDefinition(definition),
  };
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const required = requireRepo(req);
  if ("response" in required) return required.response;

  try {
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json(
        { error: "no_user_token" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    const files = await listViewRendererDefinitionFiles({
      octokit,
      owner: required.auth.owner,
      repo: required.auth.repo,
    });
    const rows = files
      .map((file) => toRow(file.definition, file.htmlUrl))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    return NextResponse.json(
      { renderers: rows },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[ViewRenderers] Error listing renderers:", error);
    return NextResponse.json(
      {
        error: "list_failed",
        message:
          error instanceof Error ? error.message : "Failed to list renderers",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const required = requireRepo(req);
  if ("response" in required) return required.response;

  try {
    const payload = saveSchema.parse(await req.json());
    const definition = parseViewRendererDefinition(payload.definition);
    if (!isValidViewRendererSlug(definition.slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    const actorResult = await verifyActorLogin(req, payload.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }
    const existing = await readViewRendererDefinitionFile({
      octokit,
      owner: required.auth.owner,
      repo: required.auth.repo,
      slug: definition.slug,
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "slug_taken",
          message: `Renderer "${definition.slug}" exists.`,
        },
        { status: 409 },
      );
    }
    const written = await writeViewRendererDefinitionFile({
      octokit,
      owner: required.auth.owner,
      repo: required.auth.repo,
      definition,
      message: `feat(renderers): add ${definition.slug}`,
    });
    recordAudit(req, {
      action: "view-renderer.create",
      resource: definition.slug,
      detail: `created view renderer ${definition.slug}`,
    });
    return NextResponse.json({
      renderer: toRow(written.definition, written.htmlUrl),
    });
  } catch (error) {
    console.error("[ViewRenderers] Error creating renderer:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "create_failed",
        message:
          error instanceof Error ? error.message : "Failed to create renderer",
      },
      { status: 500 },
    );
  }
}
