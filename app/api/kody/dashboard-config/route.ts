/**
 * @fileType api-endpoint
 * @domain dashboard-config
 * @pattern repo-config
 * @ai-summary GET — return per-repo dashboard config from state repo `dashboard.json`.
 *   PUT — upsert config (currently `defaultPreviewUrl`). Plain JSON, not encrypted.
 *   Used by the Vibe page to remember the default preview URL across users.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { resolveBackgroundToken } from "@dashboard/lib/auth/background-token";
import {
  invalidateDashboardConfigCache,
  readDashboardConfig,
  writeDashboardConfig,
  type DashboardConfig,
} from "@dashboard/lib/dashboard-config/store";
import { createUserOctokit } from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { resolveStateRepo, stateRepoPath } from "@dashboard/lib/state-repo";
import {
  repoViewIdFromPath,
  type PreviewEnvironment,
} from "@dashboard/lib/preview-environments";

const PreviewUrlSchema = z
  .string()
  .max(2048)
  .refine(
    (value) => {
      if (
        /^\/api\/kody\/views\/(?!_t\/)[A-Za-z0-9][A-Za-z0-9-]{0,63}(?:\/[^\s?#]*)?(?:\?[^#\s]*)?(?:#[^\s]*)?$/.test(
          value,
        )
      ) {
        return true;
      }
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be a valid URL" },
  );

const FlyBranchPreviewSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  branch: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^\s\x00-\x1f\x7f]+$/),
});

const PreviewEnvironmentSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(48),
    url: PreviewUrlSchema.optional(),
    flyBranch: FlyBranchPreviewSchema.optional(),
    // Present only for uploaded-file environments — keys the Fly static
    // preview so removal can also tear it down.
    staticId: z.string().min(1).max(64).optional(),
    // Absolute expiry (ms epoch) for uploaded previews; reaped past this.
    expiresAt: z.number().int().nonnegative().optional(),
    // Present only repo-backed views stored under views/<id>.
    repoViewPath: z
      .string()
      .regex(/^(?:\.kody\/)?views\/[a-z0-9][a-z0-9-]{0,63}$/)
      .optional(),
    repoViewSourceUrl: z.string().url().max(2048).optional(),
    repoViewEntryPath: z
      .string()
      .regex(/^[^\\\0]+$/)
      .max(255)
      .optional(),
    // Small, non-secret summary of uploaded files so chat can understand the
    // preview even before the inspector extension can read the iframe.
    uploadContext: z
      .object({
        name: z.string().min(1).max(255),
        mimeType: z.string().max(120).optional(),
        size: z.number().int().nonnegative().optional(),
        title: z.string().max(200).optional(),
        outline: z.string().max(4000).optional(),
        textPreview: z.string().max(2000).optional(),
      })
      .optional(),
    folderId: z.string().min(1).max(64).optional(),
  })
  .refine((value) => Boolean(value.url) || Boolean(value.flyBranch), {
    message: "Environment needs a URL or Fly branch preview",
    path: ["url"],
  })
  .refine(
    (value) => Boolean(value.url) || (!value.staticId && !value.repoViewPath),
    {
      message: "Uploaded and repo-backed views need a URL",
      path: ["url"],
    },
  );

const UpsertSchema = z.object({
  defaultPreviewUrl: z
    .string()
    .url({ message: "Must be a valid URL" })
    .max(2048)
    .optional()
    .or(z.literal("")),
  namedPreviews: z.array(PreviewEnvironmentSchema).max(20).optional(),
  previewFolders: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(40),
      }),
    )
    .max(20)
    .optional(),
  brainFlyChatEnabled: z.boolean().optional(),
  actorLogin: z.string().optional(),
});

function encodeGitHubPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function entryPathFromViewUrl(
  url: string | undefined,
  viewId: string,
): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "http://kody.local");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api" || parts[1] !== "kody" || parts[2] !== "views") {
      return null;
    }
    if (parts[3] === "_t") {
      if (parts[5] !== viewId) return null;
      return parts.slice(6).join("/") || "index.html";
    }
    if (parts[3] !== viewId) return null;
    return parts.slice(4).join("/") || "index.html";
  } catch {
    return null;
  }
}

async function withRepoViewSourceLinks(
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>,
  owner: string,
  repo: string,
  doc: DashboardConfig,
): Promise<DashboardConfig> {
  const previews = doc.namedPreviews ?? [];
  const needsSource = previews.some(
    (env) => env.repoViewPath && !env.repoViewSourceUrl,
  );
  if (!needsSource) return doc;

  try {
    const target = await resolveStateRepo(octokit, owner, repo);
    return {
      ...doc,
      namedPreviews: previews.map((env: PreviewEnvironment) => {
        if (!env.repoViewPath || env.repoViewSourceUrl) return env;
        const viewId = repoViewIdFromPath(env.repoViewPath);
        if (!viewId) return env;
        const entryPath =
          env.repoViewEntryPath ??
          entryPathFromViewUrl(env.url, viewId) ??
          "index.html";
        const repoFilePath = stateRepoPath(
          target,
          `${env.repoViewPath}/${entryPath}`,
        );
        return {
          ...env,
          repoViewEntryPath: entryPath,
          repoViewSourceUrl: `https://github.com/${target.owner}/${target.repo}/blob/${encodeURIComponent(
            target.branch,
          )}/${encodeGitHubPath(repoFilePath)}`,
        };
      }),
    };
  } catch (err) {
    logger.warn(
      { err, owner, repo },
      "dashboard-config: repo view source enrichment failed",
    );
    return doc;
  }
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const background = await resolveBackgroundToken(auth.owner, auth.repo);
  const octokit = background
    ? createUserOctokit(background.token)
    : await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  try {
    const { doc } = await readDashboardConfig(octokit, auth.owner, auth.repo);
    const config = await withRepoViewSourceLinks(
      octokit,
      auth.owner,
      auth.repo,
      doc,
    );
    return NextResponse.json({ config });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "dashboard-config: read failed",
    );
    return NextResponse.json(
      { error: "config_read_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const verify = await verifyActorLogin(req, parsed.data.actorLogin);
  if ("status" in verify) return verify;

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  try {
    const { doc, sha } = await readDashboardConfig(
      octokit,
      auth.owner,
      auth.repo,
      {
        force: true,
      },
    );
    // Partial merge: only fields present in the request body are
    // overwritten, so a Vibe-page save and a chat-default save don't
    // clobber each other's value.
    const bodyKeys = body && typeof body === "object" ? body : {};
    const next: DashboardConfig = { ...doc, version: 1 };
    let commitMessage = `chore(dashboard): update dashboard config`;
    if ("defaultPreviewUrl" in bodyKeys) {
      const trimmed = parsed.data.defaultPreviewUrl?.trim();
      next.defaultPreviewUrl = trimmed ? trimmed : undefined;
      commitMessage = `chore(dashboard): set default preview URL`;
    }
    if ("namedPreviews" in bodyKeys) {
      const list = parsed.data.namedPreviews ?? [];
      next.namedPreviews = list;
      commitMessage = `chore(dashboard): update preview environments`;
    }
    if ("previewFolders" in bodyKeys) {
      const list = parsed.data.previewFolders ?? [];
      next.previewFolders = list.length > 0 ? list : undefined;
      commitMessage = `chore(dashboard): update preview folders`;
    }
    if ("brainFlyChatEnabled" in bodyKeys) {
      next.brainFlyChatEnabled = parsed.data.brainFlyChatEnabled === true;
      commitMessage = `chore(dashboard): ${
        next.brainFlyChatEnabled ? "enable" : "disable"
      } Repo Brain in chat`;
    }
    await writeDashboardConfig(
      octokit,
      auth.owner,
      auth.repo,
      next,
      sha,
      commitMessage,
    );
    invalidateDashboardConfigCache(auth.owner, auth.repo);
    return NextResponse.json({ ok: true, config: next });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "dashboard-config: write failed",
    );
    return NextResponse.json(
      { error: "config_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
