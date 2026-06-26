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
  type ConfigPatch,
} from "@dashboard/lib/engine/config";
import { readResolvedCapabilityFile } from "@dashboard/lib/capabilities";
import { listCompanyStoreGoalTemplateFiles } from "@dashboard/lib/managed-goals-files";
import type { ManagedGoalState } from "@dashboard/lib/managed-goals";
import { isWorkflowDefinitionId } from "@dashboard/lib/workflow-definitions";
import { listCompanyStoreWorkflowDefinitionFiles } from "@dashboard/lib/workflow-definition-files";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ImportKind =
  | "agent"
  | "capability"
  | "agentGoal"
  | "agentLoop"
  | "workflow"
  | "command";

type ActiveConfigField =
  | "activeAgents"
  | "activeCapabilities"
  | "activeCommands"
  | "activeGoals"
  | "activeWorkflows";

type ImportResult = {
  imported: boolean;
  status: "imported" | "already_local";
  path: string;
};

type ActivationPlan = {
  activeAgents: string[];
  activeCapabilities: string[];
  activeCommands: string[];
  activeGoals: string[];
  activeWorkflows: string[];
};

const importSchema = z.object({
  kind: z.enum([
    "agent",
    "capability",
    "agentGoal",
    "agentLoop",
    "workflow",
    "command",
  ]),
  slug: z.string().min(1).max(128),
});

function validSlug(kind: ImportKind, slug: string): boolean {
  switch (kind) {
    case "agent":
    case "capability":
    case "agentGoal":
    case "agentLoop":
    case "command":
      return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
    case "workflow":
      return isWorkflowDefinitionId(slug);
  }
}

function configFieldFor(kind: ImportKind): ActiveConfigField {
  if (kind === "agent") return "activeAgents";
  if (kind === "capability") return "activeCapabilities";
  if (kind === "command") return "activeCommands";
  if (kind === "workflow") return "activeWorkflows";
  return "activeGoals";
}

function configPathFor(kind: ImportKind): string {
  return `company.${configFieldFor(kind)}`;
}

function activeGoalSlug(entry: ActiveGoalConfigEntry): string {
  return typeof entry === "string" ? entry : entry.template;
}

function addSlugs(entries: string[] | undefined, slugs: string[]): string[] {
  return [...new Set([...(entries ?? []), ...slugs])];
}

function addGoals(
  entries: ActiveGoalConfigEntry[] | undefined,
  slugs: string[],
): ActiveGoalConfigEntry[] {
  const next = [...(entries ?? [])];
  for (const slug of slugs) {
    if (!next.some((entry) => activeGoalSlug(entry) === slug)) {
      next.push(slug);
    }
  }
  return next;
}

function sameStringList(a: string[] | undefined, b: string[]): boolean {
  const current = a ?? [];
  return (
    current.length === b.length && current.every((value, i) => value === b[i])
  );
}

function hasGoal(
  entries: ActiveGoalConfigEntry[] | undefined,
  slug: string,
): boolean {
  return (entries ?? []).some((entry) => activeGoalSlug(entry) === slug);
}

function emptyActivationPlan(): ActivationPlan {
  return {
    activeAgents: [],
    activeCapabilities: [],
    activeCommands: [],
    activeGoals: [],
    activeWorkflows: [],
  };
}

function addPlanSlug(
  plan: ActivationPlan,
  field: keyof ActivationPlan,
  slug: string | null | undefined,
): void {
  if (!slug) return;
  if (!plan[field].includes(slug)) plan[field].push(slug);
}

function dependencyNotFound(kind: string, slug: string): Error {
  return Object.assign(
    new Error(`Store dependency "${slug}" (${kind}) was not found.`),
    { status: 404 },
  );
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
  } else if (kind === "capability") {
    const slugs = await listCompanyStoreAssetSlugs(
      octokit,
      "capabilities",
      (candidate) => validSlug("capability", candidate),
    );
    if (slugs.includes(slug)) return;
  } else if (kind === "command") {
    const slugs = await listCompanyStoreMarkdownAssetSlugs(
      octokit,
      "commands",
      (candidate) => validSlug("command", candidate),
    );
    if (slugs.includes(slug)) return;
  } else if (kind === "workflow") {
    const workflows = await listCompanyStoreWorkflowDefinitionFiles(octokit);
    if (workflows.some((workflow) => workflow.id === slug)) return;
  } else {
    const goals = await listCompanyStoreGoalTemplateFiles(octokit);
    if (goals.some((goal) => goal.id === slug)) return;
  }

  throw Object.assign(new Error(`Store item "${slug}" was not found.`), {
    status: 404,
  });
}

async function addCapabilityDependencies(
  octokit: Octokit,
  plan: ActivationPlan,
  slug: string,
): Promise<void> {
  if (!validSlug("capability", slug)) {
    throw dependencyNotFound("capability", slug);
  }

  addPlanSlug(plan, "activeCapabilities", slug);

  const capability = await readResolvedCapabilityFile(slug, octokit);
  if (!capability) throw dependencyNotFound("capability", slug);

  if (capability.agent) {
    if (!validSlug("agent", capability.agent)) {
      throw dependencyNotFound("agent", capability.agent);
    }
    addPlanSlug(plan, "activeAgents", capability.agent);
  }
}

function goalCapabilitySlugs(state: ManagedGoalState): string[] {
  const compatibility = state as ManagedGoalState & {
    capabilities?: unknown;
  };
  if (Array.isArray(compatibility.capabilities)) {
    return compatibility.capabilities.filter(
      (capability): capability is string => typeof capability === "string",
    );
  }
  return [];
}

async function activationPlanFor(
  octokit: Octokit,
  kind: ImportKind,
  slug: string,
): Promise<ActivationPlan> {
  const plan = emptyActivationPlan();

  if (kind === "agent") {
    addPlanSlug(plan, "activeAgents", slug);
    return plan;
  }

  if (kind === "capability") {
    await addCapabilityDependencies(octokit, plan, slug);
    return plan;
  }

  if (kind === "command") {
    addPlanSlug(plan, "activeCommands", slug);
    return plan;
  }

  if (kind === "workflow") {
    addPlanSlug(plan, "activeWorkflows", slug);
    const workflows = await listCompanyStoreWorkflowDefinitionFiles(octokit);
    const workflow = workflows.find((item) => item.id === slug);
    if (!workflow) throw dependencyNotFound(kind, slug);

    for (const capabilitySlug of workflow.workflow.capabilities) {
      await addCapabilityDependencies(octokit, plan, capabilitySlug);
    }

    return plan;
  }

  addPlanSlug(plan, "activeGoals", slug);
  const goals = await listCompanyStoreGoalTemplateFiles(octokit);
  const goal = goals.find((item) => item.id === slug);
  if (!goal) throw dependencyNotFound(kind, slug);

  for (const capabilitySlug of goalCapabilitySlugs(goal.state)) {
    await addCapabilityDependencies(octokit, plan, capabilitySlug);
  }

  return plan;
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
  const plan = await activationPlanFor(octokit, kind, slug);
  const nextActiveAgents =
    plan.activeAgents.length > 0
      ? addSlugs(config.company?.activeAgents, plan.activeAgents)
      : undefined;
  const nextActiveCapabilities =
    plan.activeCapabilities.length > 0
      ? addSlugs(config.company?.activeCapabilities, plan.activeCapabilities)
      : undefined;
  const nextActiveCommands =
    plan.activeCommands.length > 0
      ? addSlugs(config.company?.activeCommands, plan.activeCommands)
      : undefined;
  const nextActiveWorkflows =
    plan.activeWorkflows.length > 0
      ? addSlugs(config.company?.activeWorkflows, plan.activeWorkflows)
      : undefined;
  const nextActiveGoals =
    plan.activeGoals.length > 0 &&
    plan.activeGoals.some(
      (goalSlug) => !hasGoal(config.company?.activeGoals, goalSlug),
    )
      ? addGoals(config.company?.activeGoals, plan.activeGoals)
      : undefined;

  const patch: ConfigPatch = {
    activeAgents:
      nextActiveAgents &&
      !sameStringList(config.company?.activeAgents, nextActiveAgents)
        ? nextActiveAgents
        : undefined,
    activeCapabilities:
      nextActiveCapabilities &&
      !sameStringList(
        config.company?.activeCapabilities,
        nextActiveCapabilities,
      )
        ? nextActiveCapabilities
        : undefined,
    activeCommands:
      nextActiveCommands &&
      !sameStringList(config.company?.activeCommands, nextActiveCommands)
        ? nextActiveCommands
        : undefined,
    activeWorkflows:
      nextActiveWorkflows &&
      !sameStringList(config.company?.activeWorkflows, nextActiveWorkflows)
        ? nextActiveWorkflows
        : undefined,
    activeGoals: nextActiveGoals,
  };

  if (Object.values(patch).every((value) => value === undefined)) {
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
    patch,
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

  setGitHubContext(
    auth.owner,
    auth.repo,
    auth.token,
    auth.storeRepoUrl,
    auth.storeRef,
  );

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
