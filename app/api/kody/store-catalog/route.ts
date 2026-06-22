/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern store-catalog-api
 * @ai-summary Read-only store catalog for repo-level activation.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import {
  listCompanyStoreAssetSlugs,
  listCompanyStoreMarkdownAssetSlugs,
} from "@dashboard/lib/company-store/assets";
import {
  listAgentResponsibilityFiles,
  isValidSlug as isValidAgentResponsibilitySlug,
} from "@dashboard/lib/agent-responsibilities-files";
import {
  listAgentActionFiles,
  isValidSlug as isValidAgentActionSlug,
} from "@dashboard/lib/agent-actions";
import {
  listResolvedAgentFiles,
  isValidSlug as isValidAgentSlug,
} from "@dashboard/lib/agent-files";
import { getEngineConfig } from "@dashboard/lib/engine/config";
import { listCompanyStoreGoalTemplateFiles } from "@dashboard/lib/managed-goals-files";
import { managedGoalModel } from "@dashboard/lib/managed-goals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CatalogKind =
  | "agent"
  | "agentGoal"
  | "agentLoop"
  | "agentResponsibility"
  | "agentAction";

type CatalogStatus = "active" | "not-active" | "available" | "customized";

interface CatalogItem {
  slug: string;
  title: string;
  description: string;
  kind: CatalogKind;
  status: CatalogStatus;
  active: boolean;
  activatable: boolean;
  source: "store" | "local";
  htmlUrl: string | null;
  action?: string | null;
  agent?: string | null;
  agentAction?: string | null;
  capabilityKind?: string | null;
  schedule?: string | null;
}

function firstText(value: string | null | undefined): string {
  const text = (value ?? "")
    .replace(/^#+\s+/gm, "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .find(Boolean);
  return text ?? "";
}

function goalActivationSlug(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const template = (entry as { template?: unknown }).template;
  return typeof template === "string" ? template : null;
}

function statusFor(opts: {
  activatable: boolean;
  active: boolean;
  customized: boolean;
}): CatalogStatus {
  if (opts.customized) return "customized";
  if (!opts.activatable) return "available";
  return opts.active ? "active" : "not-active";
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(
    headerAuth.owner,
    headerAuth.repo,
    headerAuth.token,
    headerAuth.storeRepoUrl,
    headerAuth.storeRef,
  );

  try {
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const { config } = await getEngineConfig(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const activeAgentResponsibilities =
      config.company?.activeAgentResponsibilities ?? [];
    const activeGoals = config.company?.activeGoals ?? [];
    const activeAgentResponsibilitySet = new Set(activeAgentResponsibilities);
    const activeGoalSet = new Set(
      activeGoals
        .map(goalActivationSlug)
        .filter((slug): slug is string => !!slug),
    );

    const [
      agentResponsibilityStoreSlugs,
      agentActionStoreSlugs,
      agentStoreSlugs,
      agentResponsibilities,
      agentActions,
      agents,
      goalTemplates,
    ] = await Promise.all([
      listCompanyStoreAssetSlugs(
        octokit,
        "agent-responsibilities",
        isValidAgentResponsibilitySlug,
      ),
      listCompanyStoreAssetSlugs(
        octokit,
        "agent-actions",
        isValidAgentActionSlug,
      ),
      listCompanyStoreMarkdownAssetSlugs(octokit, "agents", isValidAgentSlug),
      listAgentResponsibilityFiles(),
      listAgentActionFiles(),
      listResolvedAgentFiles(),
      listCompanyStoreGoalTemplateFiles(octokit),
    ]);

    const agentResponsibilityStoreSet = new Set(agentResponsibilityStoreSlugs);
    const agentActionStoreSet = new Set(agentActionStoreSlugs);
    const agentStoreSet = new Set(agentStoreSlugs);
    const items: CatalogItem[] = [];

    for (const item of agentResponsibilities) {
      const fromStore = item.source === "store";
      const customized =
        !fromStore && agentResponsibilityStoreSet.has(item.slug);
      if (!fromStore && !customized) continue;
      const active = fromStore && activeAgentResponsibilitySet.has(item.slug);
      items.push({
        slug: item.slug,
        title: item.title,
        description: firstText(item.body),
        kind: "agentResponsibility",
        status: statusFor({ activatable: true, active, customized }),
        active,
        activatable: fromStore,
        source: fromStore ? "store" : "local",
        htmlUrl: item.htmlUrl,
        action: item.action,
        agent: item.agent,
        agentAction: item.agentAction,
        capabilityKind: item.capabilityKind,
        schedule: item.schedule,
      });
    }

    for (const item of agentActions) {
      const fromStore = item.source === "store";
      const customized = !fromStore && agentActionStoreSet.has(item.slug);
      if (!fromStore && !customized) continue;
      items.push({
        slug: item.slug,
        title: item.slug,
        description: item.describe,
        kind: "agentAction",
        status: statusFor({ activatable: false, active: false, customized }),
        active: false,
        activatable: false,
        source: fromStore ? "store" : "local",
        htmlUrl: item.htmlUrl,
        agent: item.agent,
        schedule: item.every ?? null,
      });
    }

    for (const item of agents) {
      const fromStore = item.source === "store";
      const customized = !fromStore && agentStoreSet.has(item.slug);
      if (!fromStore && !customized) continue;
      items.push({
        slug: item.slug,
        title: item.title,
        description: firstText(item.body),
        kind: "agent",
        status: statusFor({ activatable: false, active: false, customized }),
        active: false,
        activatable: false,
        source: fromStore ? "store" : "local",
        htmlUrl: item.htmlUrl,
      });
    }

    for (const item of goalTemplates) {
      const model = managedGoalModel(item);
      const active = activeGoalSet.has(item.id);
      items.push({
        slug: item.id,
        title: item.state.destination.outcome || item.id,
        description: [
          item.state.destination.outcome,
          ...item.state.destination.evidence,
        ]
          .filter(Boolean)
          .join(" - "),
        kind: model,
        status: statusFor({ activatable: true, active, customized: false }),
        active,
        activatable: true,
        source: "store",
        htmlUrl: null,
        schedule: item.state.schedule ?? null,
      });
    }

    return NextResponse.json(
      {
        items: items.sort((a, b) =>
          `${a.kind}:${a.slug}`.localeCompare(`${b.kind}:${b.slug}`),
        ),
        activeAgentResponsibilities,
        activeGoals,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "store_catalog_failed", message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
