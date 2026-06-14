/**
 * @fileType api-endpoint
 * @domain executables
 * @pattern executables-api
 * @ai-summary Import a skill from a GitHub source (the same source format the
 *   `skills` CLI uses, e.g. `vercel-labs/agent-skills` or
 *   `owner/repo/path/to/skill`). Fetches the skill's SKILL.md so the editor
 *   can add it; the skill is then committed into the executable's
 *   `skills/<name>/` folder where the engine reads it. We fetch+commit rather
 *   than run `npx skills` because that CLI installs into agent dirs
 *   (`.claude/skills/`) the engine does not read, and Vercel has no working
 *   tree to run it in.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireKodyAuth, getUserOctokit } from "@dashboard/lib/auth";

const bodySchema = z.object({
  /** `owner/repo`, `owner/repo/path/to/skill`, or a github.com URL. */
  source: z.string().min(1),
  /** Optional explicit skill folder name; defaults from the source. */
  skill: z.string().optional(),
});

/** Parse a skills source into { owner, repo, path, name }. */
function parseSource(
  raw: string,
): { owner: string; repo: string; path: string; name: string } | null {
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/(tree|blob)\/[^/]+\//, "/") // drop a /tree/<branch>/ segment
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo, ...rest] = parts;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  const path = rest.join("/");
  const name = (rest[rest.length - 1] ?? repo).toLowerCase();
  return { owner, repo, path, name };
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { source, skill } = bodySchema.parse(await req.json());
    const parsed = parseSource(source);
    if (!parsed) {
      return NextResponse.json(
        {
          error: "bad_source",
          message:
            "Use owner/repo, owner/repo/path/to/skill, or a github.com URL.",
        },
        { status: 400 },
      );
    }

    // A skill lives in a folder (the one with SKILL.md), so a bare repo URL
    // isn't enough — guide the user before we 404 on a root-level SKILL.md.
    if (!parsed.path) {
      return NextResponse.json(
        {
          error: "no_skill_path",
          message:
            "Point at the skill folder, not the repo root — paste the URL of the folder that contains SKILL.md (e.g. .../tree/main/path/to/skill).",
        },
        { status: 400 },
      );
    }

    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message: "Sign in with GitHub to import skills.",
        },
        { status: 401 },
      );
    }

    const filePath = parsed.path ? `${parsed.path}/SKILL.md` : "SKILL.md";
    let body: string;
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: parsed.owner,
        repo: parsed.repo,
        path: filePath,
      });
      if (Array.isArray(data) || !("content" in data) || !data.content) {
        return NextResponse.json(
          {
            error: "no_skill_md",
            message: `No SKILL.md at ${parsed.owner}/${parsed.repo}/${filePath}.`,
          },
          { status: 404 },
        );
      }
      body = Buffer.from(data.content, "base64").toString("utf-8");
    } catch (err: any) {
      if (err?.status === 404) {
        return NextResponse.json(
          {
            error: "not_found",
            message: `No SKILL.md at ${parsed.owner}/${parsed.repo}/${filePath}. Point the source at a folder that has one.`,
          },
          { status: 404 },
        );
      }
      throw err;
    }

    const name = (skill?.trim() || parsed.name).toLowerCase();
    return NextResponse.json({ skill: { name, body } });
  } catch (error: any) {
    console.error("[Executables] Error importing skill:", error);
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
        error: "import_failed",
        message: error?.message ?? "Failed to import skill",
      },
      { status: 500 },
    );
  }
}
