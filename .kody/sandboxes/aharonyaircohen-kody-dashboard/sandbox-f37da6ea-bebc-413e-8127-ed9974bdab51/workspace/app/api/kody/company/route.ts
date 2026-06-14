/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-api
 * @ai-summary Company import/export API. GET assembles a portable bundle
 *   (staff, duties, prompts, instructions) from the connected repo. POST
 *   applies an uploaded bundle, writing those artifacts via the file
 *   helpers — `mode` ("skip" | "overwrite") decides slug collisions.
 *   Mirrors the jobs/staff route auth pattern: header PAT for reads,
 *   verified actor + user octokit for the commits an import performs.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { buildCompanyBundle } from "@dashboard/lib/company/export";
import { applyCompanyBundle } from "@dashboard/lib/company/import";
import { companyBundleSchema } from "@dashboard/lib/company/types";

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const bundle = await buildCompanyBundle();
    return NextResponse.json({ bundle });
  } catch (error: any) {
    console.error("[Company] Error exporting company:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    if (error?.status === 403 || error?.message?.includes("rate limit")) {
      return NextResponse.json(
        { error: "rate_limited", message: "GitHub API rate limit exceeded" },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "export_failed", message: error?.message ?? "Failed to export" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const importSchema = z.object({
  bundle: companyBundleSchema,
  mode: z.enum(["skip", "overwrite"]).default("skip"),
  actorLogin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const payload = await req.json();
    const { bundle, mode, actorLogin } = importSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit imported files.",
        },
        { status: 401 },
      );
    }

    const result = await applyCompanyBundle(userOctokit, bundle, mode);
    return NextResponse.json({ result });
  } catch (error: any) {
    console.error("[Company] Error importing company:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "invalid_bundle",
          message: "That file isn't a valid Company bundle.",
          details: error.issues,
        },
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
      { error: "import_failed", message: error?.message ?? "Failed to import" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
