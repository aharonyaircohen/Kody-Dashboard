/**
 * @fileType api-endpoint
 * @domain client-chat
 * @pattern languages-api
 * @ai-summary Language registry API. Lists resolved repo + built-in client
 *   language packs and creates repo-owned JSON files under
 *   `languages/<code>.json` in the state repo.
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
  listLanguages,
  readLanguageFile,
  writeLanguageFile,
} from "@kody-ade/kody-chat/languages";
import {
  isValidLanguageCode,
  normalizeClientLanguageCode,
} from "@kody-ade/kody-chat/client-language";
import { recordAudit } from "@dashboard/lib/activity/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const languageInputSchema = z.object({
  code: z.string().trim().min(2).max(35),
  name: z.string().trim().min(1).max(80),
  strings: z.record(z.string(), z.string().max(2000)).default({}),
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
    const languages = await listLanguages();
    return NextResponse.json({ languages }, { headers: NO_STORE_HEADERS });
  } catch (error: any) {
    console.error("[Languages] Error listing languages:", error);
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
      { languages: [], error: error?.message || "Failed to list languages" },
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
    const parsed = languageInputSchema.parse(payload);
    const code = normalizeClientLanguageCode(parsed.code);
    if (
      !isValidLanguageCode(code) ||
      code !== parsed.code.trim().toLowerCase().replace(/_/g, "-")
    ) {
      return NextResponse.json(
        {
          error: "invalid_code",
          message:
            'Language code must be a lowercase BCP-47-style tag like "he" or "fr-ca".',
        },
        { status: 400 },
      );
    }

    const existing = await readLanguageFile(code);
    if (existing) {
      return NextResponse.json(
        { error: "code_taken", message: `Language "${code}" already exists.` },
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
            "A signed-in GitHub token is required to commit language files.",
        },
        { status: 401 },
      );
    }

    const language = await writeLanguageFile({
      octokit: userOctokit,
      code,
      name: parsed.name,
      strings: parsed.strings,
    });

    recordAudit(req, {
      action: "language.create",
      resource: code,
      detail: `created language ${code}`,
    });

    return NextResponse.json({ language });
  } catch (error: any) {
    console.error("[Languages] Error creating language:", error);
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
        message: error?.message ?? "Failed to create language",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
