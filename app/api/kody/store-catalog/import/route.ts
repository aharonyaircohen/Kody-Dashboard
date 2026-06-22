/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern store-catalog-import-api
 * @ai-summary Import one Store catalog asset into the connected repo.
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
import { getCompanyStoreTarget } from "@dashboard/lib/company-store/assets";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import {
  listCompanyStoreGoalTemplateFiles,
  readManagedGoalFile,
  writeManagedGoalFile,
} from "@dashboard/lib/managed-goals-files";
import {
  managedGoalPath,
  type ManagedGoalState,
} from "@dashboard/lib/managed-goals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ImportKind =
  | "agent"
  | "agentAction"
  | "agentResponsibility"
  | "agentGoal"
  | "agentLoop";

type RepoFile = {
  path: string;
  content: string;
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
  actorLogin: z.string().optional(),
});

function validSlug(kind: ImportKind, slug: string): boolean {
  if (kind === "agent") return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
  if (kind === "agentAction") return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
  if (kind === "agentResponsibility")
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

function storePathFor(kind: ImportKind, slug: string): string {
  if (kind === "agent") return `.kody/agents/${slug}.md`;
  if (kind === "agentAction") return `.kody/agent-actions/${slug}`;
  if (kind === "agentResponsibility") {
    return `.kody/agent-responsibilities/${slug}`;
  }
  return `.kody/goals/templates/${slug}/state.json`;
}

function targetPathFor(kind: ImportKind, slug: string): string {
  if (kind === "agent") return `.kody/agents/${slug}.md`;
  if (kind === "agentAction") return `.kody/agent-actions/${slug}`;
  if (kind === "agentResponsibility") {
    return `.kody/agent-responsibilities/${slug}`;
  }
  return managedGoalPath(slug);
}

function instantiateStoreGoalState(
  storeState: ManagedGoalState,
  id: string,
): ManagedGoalState {
  return {
    version: 1,
    sourceTemplate:
      typeof storeState.sourceTemplate === "string"
        ? storeState.sourceTemplate
        : id,
    state: storeState.state === "done" ? "inactive" : storeState.state,
    type: storeState.type,
    destination: storeState.destination,
    agentResponsibilities: storeState.agentResponsibilities,
    route: storeState.route,
    schedule: storeState.schedule ?? "manual",
    ...(typeof storeState.stage === "string"
      ? { stage: storeState.stage }
      : {}),
    facts: { ...storeState.facts },
    blockers: [],
  };
}

async function repoPathExists({
  octokit,
  owner,
  repo,
  path,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  path: string;
}): Promise<boolean> {
  try {
    await octokit.repos.getContent({ owner, repo, path });
    return true;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return false;
    throw error;
  }
}

async function readStoreFiles(
  octokit: Octokit,
  storePath: string,
  targetPath: string,
): Promise<RepoFile[]> {
  const store = getCompanyStoreTarget();
  const { data } = await octokit.repos.getContent({
    owner: store.owner,
    repo: store.repo,
    path: storePath,
    ref: store.ref,
  });

  if (Array.isArray(data)) {
    const nested = await Promise.all(
      data.map((entry) =>
        readStoreFiles(octokit, entry.path, `${targetPath}/${entry.name}`),
      ),
    );
    return nested.flat();
  }

  if (!("content" in data) || !data.content) {
    return [];
  }

  return [
    {
      path: targetPath,
      content: Buffer.from(data.content, "base64").toString("utf-8"),
    },
  ];
}

async function commitFiles({
  octokit,
  owner,
  repo,
  files,
  message,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  files: RepoFile[];
  message: string;
}): Promise<void> {
  const repoMeta = await octokit.repos.get({ owner, repo });
  const branch = repoMeta.data.default_branch || "main";
  const refName = `heads/${branch}`;
  const { data: ref } = await octokit.git.getRef({
    owner,
    repo,
    ref: refName,
  });
  const baseSha = ref.object.sha;
  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });
  const tree = await Promise.all(
    files.map(async (file) => {
      const { data: blob } = await octokit.git.createBlob({
        owner,
        repo,
        content: file.content,
        encoding: "utf-8",
      });
      return {
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.sha,
      };
    }),
  );
  const { data: nextTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.tree.sha,
    tree,
  });
  const { data: nextCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message,
    tree: nextTree.sha,
    parents: [baseSha],
  });
  await octokit.git.updateRef({
    owner,
    repo,
    ref: refName,
    sha: nextCommit.sha,
  });
}

async function importGoal({
  octokit,
  owner,
  repo,
  slug,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  slug: string;
}) {
  const existing = await readManagedGoalFile(slug, octokit, owner, repo);
  if (existing) {
    return {
      imported: false,
      status: "already_local",
      path: existing.path,
    };
  }

  const storeGoals = await listCompanyStoreGoalTemplateFiles(octokit);
  const storeGoal = storeGoals.find((goal) => goal.id === slug);
  if (!storeGoal) {
    throw Object.assign(new Error(`Store goal "${slug}" was not found.`), {
      status: 404,
    });
  }

  const state = instantiateStoreGoalState(storeGoal.state, slug);
  await writeManagedGoalFile({
    octokit,
    owner,
    repo,
    id: slug,
    state,
    message: `feat(store): import ${slug}`,
  });

  return {
    imported: true,
    status: "imported",
    path: managedGoalPath(slug),
  };
}

async function importRawStoreAsset({
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
}) {
  const targetPath = targetPathFor(kind, slug);
  if (await repoPathExists({ octokit, owner, repo, path: targetPath })) {
    return {
      imported: false,
      status: "already_local",
      path: targetPath,
    };
  }

  const files = await readStoreFiles(
    octokit,
    storePathFor(kind, slug),
    targetPath,
  );
  if (files.length === 0) {
    throw Object.assign(new Error(`Store item "${slug}" was not found.`), {
      status: 404,
    });
  }

  await commitFiles({
    octokit,
    owner,
    repo,
    files,
    message: `feat(store): import ${slug}`,
  });

  return {
    imported: true,
    status: "imported",
    path: targetPath,
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

    const verify = await verifyActorLogin(req, parsed.data.actorLogin);
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

    const result =
      kind === "agentGoal" || kind === "agentLoop"
        ? await importGoal({
            octokit,
            owner: auth.owner,
            repo: auth.repo,
            slug,
          })
        : await importRawStoreAsset({
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
