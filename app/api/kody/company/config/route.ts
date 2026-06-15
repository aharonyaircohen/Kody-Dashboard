/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern engine-config-api
 * @ai-summary Repo-wide engine config API for the dashboard-editable
 *   kody.config.json fields that don't have their own page: quality
 *   verification commands, comment aliases, the `@kody` access gate
 *   (`access.allowedAssociations`), and the default branch (`git.defaultBranch`).
 *   GET reads the current values; PATCH applies a partial update, preserving
 *   every untouched config key. Mirrors the operators route's auth +
 *   merge-not-overwrite pattern. Per-executable model overrides live on the
 *   models route; default PR executable on the executables route.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  getEngineConfig,
  writeConfigPatch,
  VALID_ASSOCIATIONS,
} from "@dashboard/lib/engine/config";
import { logger } from "@dashboard/lib/logger";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  try {
    const { config } = await getEngineConfig(octokit, auth.owner, auth.repo);
    return NextResponse.json({
      quality: config.quality ?? {},
      aliases: config.aliases ?? {},
      allowedAssociations: config.access?.allowedAssociations ?? [],
      defaultBranch: config.git?.defaultBranch ?? "",
      perExecutable: config.agent?.perExecutable ?? {},
      reasoningEffort: config.agent?.reasoningEffort ?? null,
    });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "config: read failed",
    );
    return NextResponse.json(
      { error: "config_read_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

// A single command string; bounded so a fat-fingered paste can't bloat the
// config blob. Empty string clears that check.
const commandSchema = z.string().max(500);

const PatchSchema = z
  .object({
    quality: z
      .object({
        typecheck: commandSchema.optional(),
        lint: commandSchema.optional(),
        format: commandSchema.optional(),
        testUnit: commandSchema.optional(),
      })
      .nullable()
      .optional(),
    aliases: z
      .record(z.string().max(64), z.string().max(64))
      .nullable()
      .optional(),
    allowedAssociations: z
      .array(z.enum(VALID_ASSOCIATIONS))
      .max(VALID_ASSOCIATIONS.length)
      .nullable()
      .optional(),
    defaultBranch: z.string().max(255).nullable().optional(),
    // Executable slug → `provider/model` override. Bounded so a paste can't
    // bloat the config blob.
    perExecutable: z
      .record(z.string().max(64), z.string().max(128))
      .nullable()
      .optional(),
    // Thinking level for the engine. Server-side validation enforces
    // the canonical vocabulary (off|low|medium|high); unknown values
    // get a 400 instead of silently landing in kody.config.json.
    reasoningEffort: z
      .enum(["off", "low", "medium", "high"])
      .nullable()
      .optional(),
    actorLogin: z.string().optional(),
  })
  // Require at least one editable field so an empty PATCH can't churn a commit.
  .refine(
    (b) =>
      b.quality !== undefined ||
      b.aliases !== undefined ||
      b.allowedAssociations !== undefined ||
      b.defaultBranch !== undefined ||
      b.perExecutable !== undefined ||
      b.reasoningEffort !== undefined,
    { message: "no_fields" },
  );

export async function PATCH(req: NextRequest) {
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

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const verify = await verifyActorLogin(req, parsed.data.actorLogin);
  if ("status" in verify) return verify;
  const actorLogin = verify.identity.login;

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  const {
    quality,
    aliases,
    allowedAssociations,
    defaultBranch,
    perExecutable,
    reasoningEffort,
  } = parsed.data;

  try {
    // Pass reasoningEffort through unchanged: an omitted field stays
    // `undefined` (writeConfigPatch treats that as "don't touch"), an
    // explicit `null` clears `agent.reasoningEffort`, and a valid enum
    // value writes the new level. Coalescing omitted → null here would
    // have every unrelated PATCH (e.g. quality-only) silently clear
    // `agent.reasoningEffort`.
    await writeConfigPatch(
      octokit,
      auth.owner,
      auth.repo,
      {
        quality,
        aliases,
        allowedAssociations,
        defaultBranch,
        perExecutable,
        reasoningEffort,
      },
      `chore(kody): update config (${actorLogin})`,
    );
    // Read back the merged result so the client reflects exactly what landed.
    const { config } = await getEngineConfig(octokit, auth.owner, auth.repo, {
      force: true,
    });
    return NextResponse.json({
      quality: config.quality ?? {},
      aliases: config.aliases ?? {},
      allowedAssociations: config.access?.allowedAssociations ?? [],
      defaultBranch: config.git?.defaultBranch ?? "",
      perExecutable: config.agent?.perExecutable ?? {},
      reasoningEffort: config.agent?.reasoningEffort ?? null,
    });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "config: write failed",
    );
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "config_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
