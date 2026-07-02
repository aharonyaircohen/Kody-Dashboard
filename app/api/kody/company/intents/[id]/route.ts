/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-intent-detail-api
 * @ai-summary Updates CTO agency-architect intent files while preserving decision logs.
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
  listCompanyStoreGoalTemplateFiles,
  readManagedGoalFile,
} from "@dashboard/lib/managed-goals-files";
import { readResolvedCapabilityFile } from "@dashboard/lib/capabilities";
import {
  companyIntentDecisionsPath,
  companyIntentPath,
  isCompanyIntentId,
  normalizeCompanyIntent,
  parseCompanyIntentDecisionLog,
  type CompanyIntent,
  type CompanyIntentManagerHealth,
  type CompanyIntentRecord,
} from "@dashboard/lib/company-intents";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";

const intentStatusSchema = z.enum(["active", "paused", "archived"]);
const intentPostureSchema = z.enum([
  "confidence",
  "speed",
  "stability-recovery",
  "maintenance",
  "balanced",
]);
const stringListSchema = z.array(z.string().trim().min(1).max(160)).default([]);
const patchSchema = z.object({
  status: intentStatusSchema.optional(),
  for: z.string().trim().min(1).max(1000).optional(),
  description: z.string().trim().max(4000).optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  posture: intentPostureSchema.optional(),
  scope: z
    .object({
      repos: stringListSchema,
      areas: stringListSchema,
    })
    .optional(),
  principles: stringListSchema.optional(),
  metrics: stringListSchema.optional(),
  policy: z
    .object({
      release: z
        .object({
          cadence: z.enum(["manual", "1d", "1w"]).optional(),
          qaDepth: z.enum(["light", "standard", "strict"]).optional(),
          blockerLevel: z.enum(["low", "standard", "strict"]).optional(),
          approval: z
            .enum(["none", "before-production", "before-risky-actions"])
            .optional(),
        })
        .optional(),
      automation: z
        .object({
          authority: z.literal("full-auto").default("full-auto"),
          maxConcurrentGoals: z.number().int().min(1).max(10),
          maxDailyActions: z.number().int().min(1).max(50),
          requiresHumanFor: stringListSchema,
        })
        .optional(),
    })
    .optional(),
  portfolio: z
    .object({
      goals: stringListSchema,
      loops: stringListSchema,
      capabilities: stringListSchema,
    })
    .optional(),
  manager: z
    .object({
      reviewEvery: z.enum(["1d", "1w"]).optional(),
    })
    .optional(),
  actorLogin: z.string().trim().optional(),
});

function mapGithubError(error: any, fallback: string, status = 500) {
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
    { error: fallback, message: error?.message ?? fallback },
    { status },
  );
}

function mergeIntent(
  current: CompanyIntent,
  patch: z.infer<typeof patchSchema>,
): CompanyIntent {
  const now = new Date().toISOString();
  return normalizeCompanyIntent(companyIntentPath(current.id), {
    ...current,
    status: patch.status ?? current.status,
    for: patch.for ?? current.for,
    description:
      patch.description !== undefined
        ? patch.description || undefined
        : current.description,
    priority: patch.priority ?? current.priority,
    posture: patch.posture ?? current.posture,
    scope: patch.scope ?? current.scope,
    principles: patch.principles ?? current.principles,
    metrics: patch.metrics ?? current.metrics,
    policy: {
      release:
        patch.policy?.release !== undefined
          ? patch.policy.release
          : current.policy.release,
      automation: patch.policy?.automation ?? current.policy.automation,
    },
    portfolio: patch.portfolio
      ? {
          goals: patch.portfolio.goals.filter(isCompanyIntentId),
          loops: patch.portfolio.loops.filter(isCompanyIntentId),
          capabilities: patch.portfolio.capabilities.filter(isCompanyIntentId),
        }
      : current.portfolio,
    manager: {
      ...current.manager,
      reviewEvery: patch.manager?.reviewEvery ?? current.manager.reviewEvery,
    },
    updatedAt: now,
  });
}

async function readRecord(
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>,
  owner: string,
  repo: string,
  id: string,
): Promise<{ record: CompanyIntentRecord; sha: string } | null> {
  const file = await readStateText(octokit, owner, repo, companyIntentPath(id));
  if (!file) return null;
  const decisions = await readStateText(
    octokit,
    owner,
    repo,
    companyIntentDecisionsPath(id),
  );
  const intent = normalizeCompanyIntent(file.path, JSON.parse(file.content));
  return {
    sha: file.sha,
    record: {
      id,
      path: file.path,
      intent,
      decisions: decisions
        ? parseCompanyIntentDecisionLog(decisions.content)
        : [],
      managerHealth: await managerHealth(octokit, intent, owner, repo),
    },
  };
}

async function managerHealth(
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>,
  intent: CompanyIntent,
  owner: string,
  repo: string,
): Promise<CompanyIntentManagerHealth> {
  const [loop, capability] = await Promise.all([
    readManagedGoalFile(intent.manager.loop, octokit, owner, repo).catch(
      () => null,
    ),
    readResolvedCapabilityFile(intent.manager.capability, octokit).catch(
      () => null,
    ),
  ]);
  const storeLoop = loop
    ? null
    : (await listCompanyStoreGoalTemplateFiles(octokit).catch(() => [])).find(
        (goal) => goal.id === intent.manager.loop,
      );
  return {
    loop: {
      id: intent.manager.loop,
      exists: Boolean(loop || storeLoop),
      state: loop?.state.state ?? storeLoop?.state.state,
      updatedAt:
        typeof loop?.state.updatedAt === "string"
          ? loop.state.updatedAt
          : undefined,
    },
    capability: {
      id: intent.manager.capability,
      exists: Boolean(capability),
    },
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  if (!isCompanyIntentId(id)) {
    return NextResponse.json({ error: "invalid_intent_id" }, { status: 400 });
  }

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  try {
    const payload = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, parsed.data.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const existing = await readRecord(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      id,
    );
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const intent = mergeIntent(existing.record.intent, parsed.data);
    await writeStateText({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      path: companyIntentPath(id),
      content: `${JSON.stringify(intent, null, 2)}\n`,
      sha: existing.sha,
      message: `chore(intents): update ${id}`,
    });

    const updated = await readRecord(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      id,
    );

    return NextResponse.json({ intent: updated?.record ?? null });
  } catch (err) {
    return mapGithubError(err, "failed_to_update_company_intent");
  } finally {
    clearGitHubContext();
  }
}
