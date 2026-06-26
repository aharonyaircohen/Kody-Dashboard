/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern store-catalog-api
 * @ai-summary Read-only neutral store catalog.
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
import { listStoreCapabilityFiles } from "@dashboard/lib/capabilities";
import { listStoreAgentFiles } from "@dashboard/lib/agent-files";
import { listStoreCommandFiles } from "@dashboard/lib/commands/files";
import { listCompanyStoreGoalTemplateFiles } from "@dashboard/lib/managed-goals-files";
import { managedGoalModel } from "@dashboard/lib/managed-goals";
import { listCompanyStoreWorkflowDefinitionFiles } from "@dashboard/lib/workflow-definition-files";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CatalogKind =
  | "agent"
  | "agentGoal"
  | "agentLoop"
  | "workflow"
  | "capability"
  | "command";

interface CatalogItem {
  slug: string;
  title: string;
  description: string;
  kind: CatalogKind;
  htmlUrl: string | null;
  action?: string | null;
  agent?: string | null;
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

    const [capabilities, agents, storeCommands, goalTemplates, storeWorkflows] =
      await Promise.all([
        listStoreCapabilityFiles(octokit),
        listStoreAgentFiles(octokit),
        listStoreCommandFiles(new Set(), octokit),
        listCompanyStoreGoalTemplateFiles(octokit),
        listCompanyStoreWorkflowDefinitionFiles(octokit),
      ]);

    const items: CatalogItem[] = [];

    for (const item of capabilities) {
      items.push({
        slug: item.slug,
        title: item.slug,
        description: item.describe,
        kind: "capability",
        htmlUrl: item.htmlUrl,
        agent: item.agent,
        schedule: item.every ?? null,
      });
    }

    for (const item of agents) {
      items.push({
        slug: item.slug,
        title: item.title,
        description: firstText(item.body),
        kind: "agent",
        htmlUrl: item.htmlUrl,
      });
    }

    for (const item of storeCommands) {
      items.push({
        slug: item.slug,
        title: `/${item.slug}`,
        description: item.description || firstText(item.body),
        kind: "command",
        htmlUrl: item.htmlUrl,
      });
    }

    for (const item of goalTemplates) {
      const model = managedGoalModel(item);
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
        htmlUrl: null,
        schedule: item.state.schedule ?? null,
      });
    }

    for (const item of storeWorkflows) {
      items.push({
        slug: item.id,
        title: item.workflow.name || item.id,
        description: item.workflow.instructions,
        kind: "workflow",
        htmlUrl: item.htmlUrl ?? null,
      });
    }

    return NextResponse.json(
      {
        items: items.sort((a, b) =>
          `${a.kind}:${a.slug}`.localeCompare(`${b.kind}:${b.slug}`),
        ),
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
