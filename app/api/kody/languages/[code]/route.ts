/**
 * @fileType api-endpoint
 * @domain client-chat
 * @pattern languages-api
 * @ai-summary Language detail API. Reads, updates, and deletes repo-owned
 *   language JSON files. Built-in English is readable and editable (editing
 *   creates a repo override) but cannot be deleted.
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
  deleteLanguageFile,
  readLanguageFile,
  writeLanguageFile,
} from "@kody-ade/kody-chat/languages";
import {
  EN_CLIENT_LANGUAGE,
  isValidLanguageCode,
  normalizeClientLanguageCode,
} from "@kody-ade/kody-chat/client-language";
import { recordAudit } from "@dashboard/lib/activity/audit";

const updateLanguageSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  strings: z.record(z.string(), z.string().max(2000)).optional(),
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
  { params }: { params: Promise<{ code: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  setContext(req);

  try {
    const { code: rawCode } = await params;
    const code = normalizeClientLanguageCode(rawCode);
    if (!isValidLanguageCode(code)) {
      return NextResponse.json({ error: "invalid_code" }, { status: 400 });
    }
    const language = await readLanguageFile(code);
    if (language) return NextResponse.json({ language });

    if (code === EN_CLIENT_LANGUAGE.code) {
      return NextResponse.json({
        language: {
          ...EN_CLIENT_LANGUAGE,
          source: "builtin",
          sha: "",
          htmlUrl: "",
        },
      });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error: any) {
    console.error("[Languages] Error fetching language:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch language",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  setContext(req);

  try {
    const { code: rawCode } = await params;
    const code = normalizeClientLanguageCode(rawCode);
    if (!isValidLanguageCode(code)) {
      return NextResponse.json({ error: "invalid_code" }, { status: 400 });
    }

    const payload = await req.json();
    const parsed = updateLanguageSchema.parse(payload);

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

    const existing = await readLanguageFile(code);
    const base =
      existing ??
      (code === EN_CLIENT_LANGUAGE.code ? EN_CLIENT_LANGUAGE : null);
    if (!base) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const language = await writeLanguageFile({
      octokit: userOctokit,
      code,
      name: parsed.name ?? base.name,
      strings: parsed.strings ?? base.strings,
      sha: existing?.sha,
      message: existing
        ? `chore(languages): update ${code}`
        : `feat(languages): override builtin ${code}`,
    });

    recordAudit(req, {
      action: existing ? "language.update" : "language.overrideBuiltin",
      resource: code,
      detail: `${existing ? "edited" : "overrode builtin"} language ${code}`,
    });

    return NextResponse.json({ language });
  } catch (error: any) {
    console.error("[Languages] Error updating language:", error);
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
        message: error?.message ?? "Failed to update language",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  setContext(req);

  try {
    const { code: rawCode } = await params;
    const code = normalizeClientLanguageCode(rawCode);
    if (!isValidLanguageCode(code)) {
      return NextResponse.json({ error: "invalid_code" }, { status: 400 });
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
            "A signed-in GitHub token is required to delete language files.",
        },
        { status: 401 },
      );
    }

    const existing = await readLanguageFile(code);
    if (!existing) {
      // Built-in English has no repo file; there is nothing to delete and
      // the default must always exist.
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await deleteLanguageFile(userOctokit, code);
    recordAudit(req, {
      action: "language.delete",
      resource: code,
      detail: `deleted language ${code}`,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Languages] Error deleting language:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete language",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
