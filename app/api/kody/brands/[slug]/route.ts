/**
 * @fileType api-endpoint
 * @domain client-chat
 * @pattern brands-api
 * @ai-summary Brand detail API. Reads, updates, and deletes repo-owned brand
 *   JSON files. Built-in fallback brands are readable through the list route
 *   but are not deleted or mutated directly.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
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
import {
  disableBrand,
  deleteBrandFile,
  isValidBrandSlug,
  isBrandDeleted,
  readBrandFile,
  writeBrandFile,
} from "@dashboard/lib/brands";
import {
  getBuiltinClientBrand,
  normalizeClientBrandLocale,
  normalizeClientBrandSlug,
} from "@dashboard/lib/client-brand";
import { recordAudit } from "@dashboard/lib/activity/audit";

const updateBrandSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  accent: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  locale: z.string().trim().max(35).nullable().optional(),
  welcomeText: z.string().trim().max(1000).nullable().optional(),
  modelId: z.string().trim().min(1).max(160).nullable().optional(),
  agentSlug: z.string().trim().min(1).max(80).nullable().optional(),
  auth: z
    .object({
      required: z.boolean().optional(),
      providers: z.array(z.string().trim().max(40)).max(10).optional(),
      allowedEmails: z.array(z.string().trim().max(320)).max(500).optional(),
      allowedDomains: z.array(z.string().trim().max(255)).max(100).optional(),
    })
    .nullable()
    .optional(),
  actorLogin: z.string().optional(),
});

function setContext(req: NextRequest) {
  const auth = getRequestAuth(req);
  if (auth) {
    setGitHubContext(
      auth.owner,
      auth.repo,
      auth.token,
      auth.storeRepoUrl,
      auth.storeRef,
    );
  }
  return auth;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  setContext(req);

  try {
    const { slug: rawSlug } = await params;
    const slug = normalizeClientBrandSlug(rawSlug);
    if (!isValidBrandSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    if (await isBrandDeleted(slug)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const brand = await readBrandFile(slug);
    if (brand) return NextResponse.json({ brand });

    const fallback = getBuiltinClientBrand(slug);
    if (fallback) {
      return NextResponse.json({
        brand: {
          ...fallback,
          source: "builtin",
          sha: "",
          updatedAt: "",
          htmlUrl: "",
        },
      });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error: any) {
    console.error("[Brands] Error fetching brand:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch brand",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  setContext(req);

  try {
    const { slug: rawSlug } = await params;
    const slug = normalizeClientBrandSlug(rawSlug);
    if (!isValidBrandSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    if (await isBrandDeleted(slug)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const payload = await req.json();
    const parsed = updateBrandSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, parsed.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit brand files.",
        },
        { status: 401 },
      );
    }

    const existing = await readBrandFile(slug);
    const base = existing ?? getBuiltinClientBrand(slug);
    if (!base) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const brand = await writeBrandFile({
      octokit: userOctokit,
      slug,
      name: parsed.name ?? base.name,
      accent: parsed.accent ?? base.accent,
      locale:
        parsed.locale === undefined
          ? base.locale
          : normalizeClientBrandLocale(parsed.locale ?? undefined),
      welcomeText:
        parsed.welcomeText === undefined
          ? base.welcomeText
          : (parsed.welcomeText ?? undefined),
      modelId:
        parsed.modelId === undefined
          ? base.modelId
          : (parsed.modelId ?? undefined),
      agentSlug:
        parsed.agentSlug === undefined
          ? base.agentSlug
          : (parsed.agentSlug ?? undefined),
      auth: parsed.auth === undefined ? base.auth : (parsed.auth ?? undefined),
      sha: existing?.sha,
      message: existing
        ? `chore(brands): update ${slug}`
        : `feat(brands): override fallback ${slug}`,
    });

    recordAudit(req, {
      action: existing ? "brand.update" : "brand.overrideFallback",
      resource: slug,
      detail: `${existing ? "edited" : "overrode fallback"} brand ${slug}`,
    });

    return NextResponse.json({ brand });
  } catch (error: any) {
    console.error("[Brands] Error updating brand:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "update_failed",
        message: error?.message ?? "Failed to update brand",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  setContext(req);

  try {
    const { slug: rawSlug } = await params;
    const slug = normalizeClientBrandSlug(rawSlug);
    if (!isValidBrandSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const actorLogin =
      new URL(req.url).searchParams.get("actorLogin") ?? undefined;
    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to delete brand files.",
        },
        { status: 401 },
      );
    }

    const existing = await readBrandFile(slug);
    const fallback = getBuiltinClientBrand(slug);
    if (!existing && !fallback) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (existing) {
      await deleteBrandFile(userOctokit, slug);
    }
    if (fallback) {
      await disableBrand(userOctokit, slug);
    }
    recordAudit(req, {
      action: "brand.delete",
      resource: slug,
      detail: `deleted brand ${slug}`,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Brands] Error deleting brand:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete brand",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
