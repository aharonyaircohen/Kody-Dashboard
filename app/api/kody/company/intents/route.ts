/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-intents-api
 * @ai-summary Lists and creates CTO agency-architect intents in configured Kody state repo.
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
import { logger } from "@dashboard/lib/logger";
import {
  listCompanyStoreGoalTemplateFiles,
  readManagedGoalFile,
} from "@dashboard/lib/managed-goals-files";
import { readResolvedCapabilityFile } from "@dashboard/lib/capabilities";
import {
  buildCompanyIntent,
  companyIntentDecisionsPath,
  companyIntentPath,
  isCompanyIntentId,
  normalizeCompanyIntent,
  parseCompanyIntentDecisionLog,
  RELEASE_CADENCES,
  slugifyCompanyIntentId,
  sortCompanyIntentRecords,
  type CompanyIntent,
  type CompanyIntentInput,
  type CompanyIntentManagerHealth,
  type CompanyIntentRecord,
} from "@dashboard/lib/company-intents";
import {
  clearCompanyIntentRecordsCache,
  getCachedCompanyIntentRecords,
} from "@dashboard/lib/company-intents-read-cache";
import {
  listStateDirectory,
  readStateText,
  writeStateText,
} from "@dashboard/lib/state-repo";

const intentStatusSchema = z.enum(["active", "paused", "archived"]);
const intentPostureSchema = z.enum([
  "confidence",
  "speed",
  "stability-recovery",
  "maintenance",
  "balanced",
]);
const stringListSchema = z.array(z.string().trim().min(1).max(160)).default([]);
const releasePolicySchema = z
  .object({
    cadence: z.enum(RELEASE_CADENCES).optional(),
    qaDepth: z.enum(["light", "standard", "strict"]).optional(),
    blockerLevel: z.enum(["low", "standard", "strict"]).optional(),
    approval: z
      .enum(["none", "before-production", "before-risky-actions"])
      .optional(),
  })
  .optional();
const intentPayloadSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  for: z.string().trim().min(1).max(1000),
  description: z.string().trim().max(4000).optional(),
  priority: z.number().int().min(1).max(1000).default(100),
  posture: intentPostureSchema.default("balanced"),
  status: intentStatusSchema.default("active"),
  scope: z
    .object({
      repos: stringListSchema,
      areas: stringListSchema,
    })
    .default({ repos: [], areas: [] }),
  principles: stringListSchema,
  metrics: stringListSchema,
  policy: z
    .object({
      release: releasePolicySchema,
      automation: z
        .object({
          authority: z.literal("full-auto").default("full-auto"),
          maxConcurrentGoals: z.number().int().min(1).max(10).default(1),
          maxDailyActions: z.number().int().min(1).max(50).default(5),
          requiresHumanFor: stringListSchema,
        })
        .default({
          authority: "full-auto",
          maxConcurrentGoals: 1,
          maxDailyActions: 5,
          requiresHumanFor: [],
        }),
    })
    .default({
      automation: {
        authority: "full-auto",
        maxConcurrentGoals: 1,
        maxDailyActions: 5,
        requiresHumanFor: [],
      },
    }),
  portfolio: z
    .object({
      goals: stringListSchema,
      loops: stringListSchema,
      capabilities: stringListSchema,
    })
    .default({ goals: [], loops: [], capabilities: [] }),
  manager: z
    .object({
      reviewEvery: z.enum(["1d", "1w"]).default("1d"),
    })
    .default({ reviewEvery: "1d" }),
  actorLogin: z.string().trim().optional(),
});

function isCompanyIntentRecord(
  record: CompanyIntentRecord | null,
): record is CompanyIntentRecord {
  return record !== null;
}

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

function normalizeIntentInput(
  data: z.infer<typeof intentPayloadSchema>,
): CompanyIntentInput {
  const id = data.id?.trim() || slugifyCompanyIntentId(data.for);
  return {
    id,
    for: data.for,
    ...(data.description ? { description: data.description } : {}),
    priority: data.priority,
    posture: data.posture,
    status: data.status,
    scope: data.scope,
    principles: data.principles,
    metrics: data.metrics,
    policy: data.policy,
    portfolio: {
      goals: data.portfolio.goals.filter(isCompanyIntentId),
      loops: data.portfolio.loops.filter(isCompanyIntentId),
      capabilities: data.portfolio.capabilities.filter(isCompanyIntentId),
    },
    manager: data.manager,
  };
}

async function managerHealth(
  octokit: Awaited<ReturnType<typeof getUserOctokit>>,
  intent: CompanyIntent,
  owner: string,
  repo: string,
): Promise<CompanyIntentManagerHealth | undefined> {
  if (!octokit) return undefined;
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

async function readIntentRecord({
  octokit,
  owner,
  repo,
  id,
}: {
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>;
  owner: string;
  repo: string;
  id: string;
}): Promise<CompanyIntentRecord | null> {
  const intentFile = await readStateText(
    octokit,
    owner,
    repo,
    companyIntentPath(id),
  );
  if (!intentFile) return null;

  const decisionsFile = await readStateText(
    octokit,
    owner,
    repo,
    companyIntentDecisionsPath(id),
  );
  const intent = normalizeCompanyIntent(
    intentFile.path,
    JSON.parse(intentFile.content),
  );
  return {
    id,
    path: intentFile.path,
    intent,
    decisions: decisionsFile
      ? parseCompanyIntentDecisionLog(decisionsFile.content)
      : [],
    managerHealth: await managerHealth(octokit, intent, owner, repo),
  };
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const intents = await getCachedCompanyIntentRecords(
      headerAuth.owner,
      headerAuth.repo,
      async () => {
        const { entries } = await listStateDirectory(
          octokit,
          headerAuth.owner,
          headerAuth.repo,
          "intents",
        );

        const records = await Promise.all(
          entries
            .filter(
              (entry) =>
                entry.type === "dir" &&
                typeof entry.name === "string" &&
                isCompanyIntentId(entry.name),
            )
            .map(async (entry): Promise<CompanyIntentRecord | null> => {
              try {
                return await readIntentRecord({
                  octokit,
                  owner: headerAuth.owner,
                  repo: headerAuth.repo,
                  id: entry.name,
                });
              } catch (err) {
                logger.warn(
                  { err, id: entry.name },
                  "company-intents: skipped malformed file",
                );
                return null;
              }
            }),
        );

        return sortCompanyIntentRecords(records.filter(isCompanyIntentRecord));
      },
    );

    return NextResponse.json(
      {
        intents,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return mapGithubError(err, "failed_to_list_company_intents");
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const payload = await req.json().catch(() => null);
    const parsed = intentPayloadSchema.safeParse(payload);
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

    const intent = buildCompanyIntent(normalizeIntentInput(parsed.data));
    const existing = await readStateText(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      companyIntentPath(intent.id),
    );
    if (existing) {
      return NextResponse.json(
        {
          error: "intent_exists",
          message: `Intent "${intent.id}" already exists.`,
        },
        { status: 409 },
      );
    }

    await writeStateText({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      path: companyIntentPath(intent.id),
      content: `${JSON.stringify(intent, null, 2)}\n`,
      message: `chore(intents): create ${intent.id}`,
    });
    clearCompanyIntentRecordsCache(headerAuth.owner, headerAuth.repo);

    const record = await readIntentRecord({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      id: intent.id,
    });

    return NextResponse.json({ intent: record }, { status: 201 });
  } catch (err) {
    return mapGithubError(err, "failed_to_create_company_intent");
  } finally {
    clearGitHubContext();
  }
}
