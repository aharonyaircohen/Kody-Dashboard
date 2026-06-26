/**
 * @fileType api-endpoint
 * @domain capabilities
 * @pattern capabilities-api
 * @ai-summary Capabilities Control API — GET lists custom capabilities stored
 *   at `capabilities/<slug>/` in the state repo, POST creates one.
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
import {
  listCapabilityFiles,
  readCapabilityFile,
  writeCapabilityFile,
  isValidSlug,
  PERMISSION_MODES,
  CAPABILITY_KINDS,
} from "@dashboard/lib/capabilities";
import { getEngineConfig } from "@dashboard/lib/engine/config";
import { recordAudit } from "@dashboard/lib/activity/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function activeCapabilitySlugs(company: unknown): string[] {
  if (!company || typeof company !== "object") return [];
  const raw = company as {
    activeCapabilities?: unknown;
    activeAgentActions?: unknown;
  };
  if (Array.isArray(raw.activeCapabilities)) {
    return raw.activeCapabilities.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }
  if (Array.isArray(raw.activeAgentActions)) {
    return raw.activeAgentActions.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }
  return [];
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );

  try {
    const activeCapabilities = new Set<string>();
    let defaults = { issue: null as string | null, pr: null as string | null };
    if (headerAuth) {
      const userOctokit = await getUserOctokit(req);
      if (userOctokit) {
        const { config } = await getEngineConfig(
          userOctokit,
          headerAuth.owner,
          headerAuth.repo,
        );
        defaults = {
          issue: config.defaultAgentAction ?? null,
          pr: config.defaultPrAgentAction ?? null,
        };
        for (const slug of activeCapabilitySlugs(config.company)) {
          activeCapabilities.add(slug);
        }
      }
    }
    const capabilities = (await listCapabilityFiles()).filter(
      (item) => item.source !== "store" || activeCapabilities.has(item.slug),
    );
    return NextResponse.json(
      { capabilities, agentActions: capabilities, defaults },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error: any) {
    console.error("[Capabilities] Error listing capabilities:", error);
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
      {
        capabilities: [],
        agentActions: [],
        error: error?.message || "Failed to list capabilities",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}

const skillSchema = z.object({
  name: z.string().min(1).max(64),
  body: z.string().default(""),
});
const shellSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9._-]+\.sh$/, "must be a *.sh filename"),
  content: z.string().default(""),
});
const mcpServerSchema = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, "letters, digits, dash, underscore"),
  command: z.string().min(1, "command is required"),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const createCapabilitySchema = z
  .object({
    slug: z.string().min(1).max(64),
    describe: z.string().default(""),
    capabilityKind: z.enum(CAPABILITY_KINDS).default("act"),
    instructions: z.string().min(1, "instructions are required").optional(),
    prompt: z.string().min(1).optional(),
    model: z.string().default("inherit"),
    permissionMode: z.enum(PERMISSION_MODES).default("acceptEdits"),
    tools: z.array(z.string()).default([]),
    skills: z.array(skillSchema).default([]),
    shellScripts: z.array(shellSchema).default([]),
    mcpServers: z.array(mcpServerSchema).default([]),
    landing: z.enum(["pr", "comment"]).default("pr"),
    profileJsonOverride: z.string().optional(),
    actorLogin: z.string().optional(),
  })
  .refine((input) => input.instructions || input.prompt, {
    message: "instructions are required",
    path: ["instructions"],
  });

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );

  try {
    const input = createCapabilitySchema.parse(await req.json());
    const instructions = input.instructions ?? input.prompt ?? "";

    if (!isValidSlug(input.slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Capability name must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }

    const existing = await readCapabilityFile(input.slug);
    if (existing) {
      return NextResponse.json(
        {
          error: "slug_taken",
          message: `Capability "${input.slug}" already exists.`,
        },
        { status: 409 },
      );
    }

    const actorResult = await verifyActorLogin(req, input.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit capability files.",
        },
        { status: 401 },
      );
    }

    const capability = await writeCapabilityFile({
      octokit: userOctokit,
      fields: {
        slug: input.slug,
        describe: input.describe,
        capabilityKind: input.capabilityKind,
        prompt: instructions,
        model: input.model,
        permissionMode: input.permissionMode,
        tools: input.tools,
        skills: input.skills.map((s) => s.name),
        shellScripts: input.shellScripts.map((s) => s.name),
        mcpServers: input.mcpServers,
        landing: input.landing,
      },
      skills: input.skills,
      shellScripts: input.shellScripts,
      profileJsonOverride: input.profileJsonOverride,
    });

    recordAudit(req, {
      action: "capability.create",
      resource: input.slug,
      detail: `created capability ${input.slug}`,
    });

    return NextResponse.json({ capability, agentAction: capability });
  } catch (error: any) {
    console.error("[Capabilities] Error creating capability:", error);
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
        message: error?.message ?? "Failed to create capability",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
