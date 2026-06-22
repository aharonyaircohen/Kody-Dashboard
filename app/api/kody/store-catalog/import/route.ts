/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern store-catalog-import-api
 * @ai-summary Add one Store catalog asset by reference.
 */

import type { Octokit } from "@octokit/rest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@dashboard/lib/auth";
import {
  listCompanyStoreAssetSlugs,
  listCompanyStoreMarkdownAssetSlugs,
} from "@dashboard/lib/company-store/assets";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import {
  getEngineConfig,
  writeConfigPatch,
  type ActiveGoalConfigEntry,
} from "@dashboard/lib/engine/config";
import { listCompanyStoreGoalTemplateFiles } from "@dashboard/lib/managed-goals-files";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ImportKind =
  | "agent"
  | "agentAction"
  | "agentResponsibility"
  | "agentGoal"
  | "agentLoop";

type ActiveConfigField =
  | "activeAgents"
  | "activeAgentActions"
  | "activeAgentResponsibilities"
  | "activeGoals";

type ImportResult = {
  imported: boolean;
  status: "imported" | "already_local";
  path: string;
};

const importSchema = z.object({
  kind: z.enum([
    "agent",
    "agentAction",
    "agentResponsibility",
    "agentGoal",
    "agentLoop",
  ]),
  slug: z.string().min(1).max(128),
});

function validSlug(kind: ImportKind, slug: string): boolean {
  switch (kind) {
    case "agent":
    case "agentAction":
    case "agentResponsibility":
    case "agentGoal":
    case "agentLoop":
      return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
  }
}

function configFieldFor(kind: ImportKind): ActiveConfigField {
  if (kind === "agent") return "activeAgents";
  if (kind === "agentAction") return "activeAgentActions";
  if (kind === "agentResponsibility") return "activeAgentResponsibilities";
  return "activeGoals";
}

function configPathFor(kind: ImportKind): string {
  return `company.${configFieldFor(kind)}`;
}

function activeGoalSlug(entry: ActiveGoalConfigEntry): string {
  return typeof entry === "string" ? entry : entry.template;
}

function addSlug(entries: string[] | undefined, slug: string): string[] {
  return [...new Set([...(entries ?? []), slug])];
}

function addGoal(
  entries: ActiveGoalConfigEntry[] | undefined,
  slug: string,
): ActiveGoalConfigEntry[] {
  const withoutExisting = (entries ?? []).filter(
    (entry) => activeGoalSlug(entry) !== slug,
  );
  return [...withoutExisting, slug];
}

async function assertStoreItemExists(
  octokit: Octokit,
  kind: ImportKind,
  slug: string,
): Promise<void> {
  if (kind === "agent") {
    const slugs = await listCompanyStoreMarkdownAssetSlugs(
      octokit,
      "agents",
      (candidate) => validSlug("agent", candidate),
    );
    if (slugs.includes(slug)) return;
  } else if (kind === "agentAction") {
    const slugs = await listCompanyStoreAssetSlugs(
      octokit,
      "agent-actions",
      (candidate) => validSlug("agentAction", candidate),
    );
    if (slugs.includes(slug)) return;
  } else if (kind === "agentResponsibility") {
    const slugs = await listCompanyStoreAssetSlugs(
      octokit,
      "agent-responsibilities",
      (candidate) => validSlug("agentResponsibility", candidate),
    );
    if (slugs.includes(slug)) return;
  } else {
    const goals = await listCompanyStoreGoalTemplateFiles(octokit);
    if (goals.some((goal) => goal.id === slug)) return;
  }

  throw Object.assign(new Error(`Store item "${slug}" was not found.`), {
    status: 404,
  });
}

async function addStoreReference({
  octokit,
  owner,
  repo,
  kind,
  slug,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  kind: ImportKind;
  slug: string;
}): Promise<ImportResult> {
  await assertStoreItemExists(octokit, kind, slug);

  const { config } = await getEngineConfig(octokit, owner, repo, {
    force: true,
  });
  const field = configFieldFor(kind);
  const alreadyLinked =
    field === "activeGoals"
      ? (config.company?.activeGoals ?? []).some(
          (entry) => activeGoalSlug(entry) === slug,
        )
      : (config.company?.[field] ?? []).includes(slug);

  if (alreadyLinked) {
    return {
      imported: false,
      status: "already_local",
      path: configPathFor(kind),
    };
  }

  await writeConfigPatch(
    octokit,
    owner,
    repo,
    {
      activeAgents:
        field === "activeAgents"
          ? addSlug(config.company?.activeAgents, slug)
          : undefined,
      activeAgentActions:
        field === "activeAgentActions"
          ? addSlug(config.company?.activeAgentActions, slug)
          : undefined,
      activeAgentResponsibilities:
        field === "activeAgentResponsibilities"
          ? addSlug(config.company?.activeAgentResponsibilities, slug)
          : undefined,
      activeGoals:
        field === "activeGoals"
          ? addGoal(config.company?.activeGoals, slug)
          : undefined,
    },
    `chore(kody): add store ${kind} ${slug}`,
  );

  return {
    imported: true,
    status: "imported",
    path: configPathFor(kind),
  };
}

function errorResponse(error: unknown) {
  const status = (error as { status?: number })?.status;
  if (status === 401) {
    return NextResponse.json(
      { error: "github_token_expired" },
      { status: 401 },
    );
  }
  if (status === 404) {
    return NextResponse.json(
      {
        error: "store_item_not_found",
        message:
          error instanceof Error ? error.message : "Store item not found.",
      },
      { status: 404 },
    );
  }
  return NextResponse.json(
    {
      error: "store_import_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    },
    { status: 500 },
  );
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(auth.owner, auth.repo, auth.token);

  try {
    const body = await req.json().catch(() => null);
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const verify = await verifyActorLogin(req, undefined);
    if ("status" in verify) return verify;

    const { kind, slug } = parsed.data;
    if (!validSlug(kind, slug)) {
      return NextResponse.json(
        { error: "invalid_slug", message: `Invalid ${kind} slug: "${slug}".` },
        { status: 400 },
      );
    }

    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_octokit" }, { status: 401 });
    }

    const result = await addStoreReference({
      octokit,
      owner: auth.owner,
      repo: auth.repo,
      kind,
      slug,
    });

    return NextResponse.json({
      kind,
      slug,
      ...result,
    });
  } catch (error: unknown) {
    return errorResponse(error);
  } finally {
    clearGitHubContext();
  }
}
