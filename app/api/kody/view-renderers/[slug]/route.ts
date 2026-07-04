/**
 * @fileType api-endpoint
 * @domain view-renderers
 * @pattern state-repo-crud-api
 * @ai-summary Reads, updates, and deletes one view renderer definition.
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
  deleteViewRendererDefinitionFile,
  isValidViewRendererSlug,
  parseViewRendererDefinition,
  readViewRendererDefinitionFile,
  serializeViewRendererDefinition,
  writeViewRendererDefinitionFile,
  type ViewRendererDefinition,
} from "@dashboard/lib/view-renderers/renderers";

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
        { status: 401 },
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const required = requireRepo(req);
  if ("response" in required) return required.response;

  try {
    const { slug } = await params;
    if (!isValidViewRendererSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }
    const existing = await readViewRendererDefinitionFile({
      octokit,
      owner: required.auth.owner,
      repo: required.auth.repo,
      slug,
    });
    if (existing) {
      return NextResponse.json({
        renderer: toRow(existing.definition, existing.htmlUrl),
      });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    console.error("[ViewRenderers] Error fetching renderer:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message:
          error instanceof Error ? error.message : "Failed to fetch renderer",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const required = requireRepo(req);
  if ("response" in required) return required.response;

  try {
    const { slug } = await params;
    if (!isValidViewRendererSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    const payload = saveSchema.parse(await req.json());
    const definition = parseViewRendererDefinition(payload.definition);
    if (definition.slug !== slug) {
      return NextResponse.json(
        { error: "slug_mismatch", message: "Renderer slug cannot change." },
        { status: 400 },
      );
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
      slug,
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const written = await writeViewRendererDefinitionFile({
      octokit,
      owner: required.auth.owner,
      repo: required.auth.repo,
      definition,
      sha: existing.sha,
      message: `chore(renderers): update ${slug}`,
    });
    recordAudit(req, {
      action: "view-renderer.update",
      resource: slug,
      detail: `edited view renderer ${slug}`,
    });
    return NextResponse.json({
      renderer: toRow(written.definition, written.htmlUrl),
    });
  } catch (error) {
    console.error("[ViewRenderers] Error updating renderer:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "update_failed",
        message:
          error instanceof Error ? error.message : "Failed to update renderer",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const required = requireRepo(req);
  if ("response" in required) return required.response;

  try {
    const { slug } = await params;
    if (!isValidViewRendererSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    const { searchParams } = new URL(req.url);
    const actorLogin = searchParams.get("actorLogin") ?? undefined;
    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }
    const existing = await readViewRendererDefinitionFile({
      octokit,
      owner: required.auth.owner,
      repo: required.auth.repo,
      slug,
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await deleteViewRendererDefinitionFile({
      octokit,
      owner: required.auth.owner,
      repo: required.auth.repo,
      slug,
      sha: existing.sha,
      message: `chore(renderers): delete ${slug}`,
    });
    recordAudit(req, {
      action: "view-renderer.delete",
      resource: slug,
      detail: `deleted view renderer ${slug}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ViewRenderers] Error deleting renderer:", error);
    return NextResponse.json(
      {
        error: "delete_failed",
        message:
          error instanceof Error ? error.message : "Failed to delete renderer",
      },
      { status: 500 },
    );
  }
}
