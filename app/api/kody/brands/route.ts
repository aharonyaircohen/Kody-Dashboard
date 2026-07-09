/**
 * @fileType api-endpoint
 * @domain client-chat
 * @pattern brands-api
 * @ai-summary Brand registry API. Lists resolved repo+built-in client brands
 *   and creates repo-owned brand JSON files under `brands/<slug>.json` in the
 *   state repo.
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
  isValidBrandSlug,
  listBrands,
  readBrandFile,
  writeBrandFile,
} from "@dashboard/lib/brands";
import {
  normalizeClientBrandLocale,
  normalizeClientBrandSlug,
} from "@dashboard/lib/client-brand";
import { recordAudit } from "@dashboard/lib/activity/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const brandInputSchema = z.object({
  slug: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  accent: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/),
  locale: z.string().trim().max(35).optional(),
  welcomeText: z.string().trim().max(1000).optional(),
  modelId: z.string().trim().min(1).max(160).optional(),
  agentSlug: z.string().trim().min(1).max(80).optional(),
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

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  setContext(req);

  try {
    const brands = await listBrands();
    return NextResponse.json({ brands }, { headers: NO_STORE_HEADERS });
  } catch (error: any) {
    console.error("[Brands] Error listing brands:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    if (error?.status === 403 || error?.message?.includes("rate limit")) {
      return NextResponse.json(
        { error: "rate_limited", message: "GitHub API rate limit exceeded" },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { brands: [], error: error?.message || "Failed to list brands" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  setContext(req);

  try {
    const payload = await req.json();
    const parsed = brandInputSchema.parse(payload);
    const slug = normalizeClientBrandSlug(parsed.slug);
    if (!isValidBrandSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Brand slug must use lowercase letters, digits, or dashes and start with a letter or digit.",
        },
        { status: 400 },
      );
    }

    const existing = await readBrandFile(slug);
    if (existing) {
      return NextResponse.json(
        { error: "slug_taken", message: `Brand "${slug}" already exists.` },
        { status: 409 },
      );
    }

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

    const brand = await writeBrandFile({
      octokit: userOctokit,
      slug,
      name: parsed.name,
      accent: parsed.accent,
      locale: normalizeClientBrandLocale(parsed.locale),
      welcomeText: parsed.welcomeText,
      modelId: parsed.modelId,
      agentSlug: parsed.agentSlug,
    });

    recordAudit(req, {
      action: "brand.create",
      resource: slug,
      detail: `created brand ${slug}`,
    });

    return NextResponse.json({ brand });
  } catch (error: any) {
    console.error("[Brands] Error creating brand:", error);
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
        error: "create_failed",
        message: error?.message ?? "Failed to create brand",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
