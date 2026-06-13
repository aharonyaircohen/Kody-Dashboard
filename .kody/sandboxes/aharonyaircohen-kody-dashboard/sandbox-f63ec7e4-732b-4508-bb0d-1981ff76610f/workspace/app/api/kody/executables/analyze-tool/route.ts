/**
 * @fileType api-endpoint
 * @domain executables
 * @pattern executables-api
 * @ai-summary Analyze a GitHub repo and propose how to wire it as an MCP tool
 *   server for an executable. Fetches the repo's README + package.json, then
 *   asks the user's configured chat model to extract the install command and
 *   the `command`/`args` for the tool's MCP stdio server. Returns a *proposal*
 *   the editor pre-fills for the user to review — nothing is committed here.
 *   This removes the need for the user to know a tool's CLI/MCP invocation
 *   (the unintuitive part of the Tools tab): paste a URL, review, save.
 *   Mirrors the import-skill route's source parsing + GitHub fetch.
 */
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { requireKodyAuth, getUserOctokit } from "@dashboard/lib/auth";
import { stripReasoning } from "@dashboard/lib/chat/reasoning";
import { resolveChatModel } from "../../chat/resolve-model";

export const runtime = "nodejs";

const bodySchema = z.object({
  /** `owner/repo` or a github.com URL. */
  source: z.string().min(1),
  /** Optional client model override (same contract as the chat routes). */
  model: z.string().optional(),
});

/** Parse a repo source into { owner, repo }. Mirrors import-skill's parser. */
function parseRepo(raw: string): { owner: string; repo: string } | null {
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/(tree|blob)\/[^/]+\/.*$/, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return { owner, repo };
}

/** Shape the model is asked to return; also the response contract. */
const proposalSchema = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .describe("short server name, letters/digits/dash/underscore"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  installCommand: z.string().default(""),
  isMcpServer: z.boolean().default(true),
  notes: z.string().default(""),
});
type Proposal = z.infer<typeof proposalSchema>;

const SYSTEM_PROMPT = [
  "You configure external tools for an AI coding agent. Given a GitHub repo's",
  "README and package.json, determine how to run it as an MCP (Model Context",
  "Protocol) stdio server and how to install it in a fresh CI runner.",
  "",
  "Reply with ONLY a JSON object (no prose, no code fences):",
  "{",
  '  "name": "<short server name: letters, digits, dash, underscore>",',
  '  "command": "<the executable to launch the MCP server>",',
  '  "args": ["<arg>", "..."],',
  '  "installCommand": "<shell to make the command available, e.g. npm i -g <pkg>; include any index/init step>",',
  '  "isMcpServer": <true if the repo ships an MCP stdio server, else false>,',
  '  "notes": "<one short line; if not an MCP server, say so here>"',
  "}",
  "",
  "Rules: prefer the documented MCP stdio invocation (often `serve --mcp` or",
  "an `mcp` subcommand). Use the package.json `name` for global installs and",
  "the `bin` key for the command. If the repo is NOT an MCP server, set",
  "isMcpServer=false and put your best guess in command/args anyway.",
].join("\n");

async function fetchText(
  octokit: Awaited<ReturnType<typeof getUserOctokit>>,
  owner: string,
  repo: string,
  path: string,
): Promise<string | null> {
  if (!octokit) return null;
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/** Pull the first JSON object out of a model reply (tolerates fences/prose/<think>). */
function extractJson(text: string): unknown | null {
  // Thinking models emit a <think>…</think> scratchpad first — strip it so a
  // stray "{" inside the reasoning doesn't capture a non-JSON span.
  const stripped = stripReasoning(text);
  const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : stripped;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { source, model } = bodySchema.parse(await req.json());
    const parsed = parseRepo(source);
    if (!parsed) {
      return NextResponse.json(
        {
          error: "bad_source",
          message: "Use owner/repo or a github.com URL.",
        },
        { status: 400 },
      );
    }

    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json(
        { error: "no_user_token", message: "Sign in with GitHub to analyze." },
        { status: 401 },
      );
    }

    const [readme, pkg] = await Promise.all([
      fetchText(octokit, parsed.owner, parsed.repo, "README.md"),
      fetchText(octokit, parsed.owner, parsed.repo, "package.json"),
    ]);
    if (readme === null && pkg === null) {
      return NextResponse.json(
        {
          error: "not_found",
          message: `No README.md or package.json at ${parsed.owner}/${parsed.repo}.`,
        },
        { status: 404 },
      );
    }

    const resolution = await resolveChatModel(req, model);
    if ("error" in resolution) return resolution.error;

    const userContent = [
      `Repo: ${parsed.owner}/${parsed.repo}`,
      "",
      "=== package.json (truncated) ===",
      (pkg ?? "(none)").slice(0, 4000),
      "",
      "=== README.md (truncated) ===",
      (readme ?? "(none)").slice(0, 8000),
    ].join("\n");

    const { text } = await generateText({
      model: resolution.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      // Generous budget: thinking models spend tokens on a <think> scratchpad
      // before the JSON, so a tight cap truncates the actual answer.
      maxOutputTokens: 2000,
      temperature: 0.1,
    });

    const raw = extractJson(text);
    if (!raw) {
      return NextResponse.json(
        {
          error: "unparseable_proposal",
          message: "The model did not return a usable JSON proposal.",
        },
        { status: 502 },
      );
    }

    const result = proposalSchema.safeParse(raw);
    if (!result.success) {
      return NextResponse.json(
        {
          error: "invalid_proposal",
          message: "Proposal failed validation.",
          details: result.error.issues,
        },
        { status: 502 },
      );
    }

    // Default the name to the repo if the model left it blank/odd.
    const proposal: Proposal = {
      ...result.data,
      name:
        result.data.name ||
        parsed.repo.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
    };
    return NextResponse.json({ proposal });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    const status = (error as { status?: number })?.status;
    if (status === 401)
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    return NextResponse.json(
      {
        error: "analyze_failed",
        message:
          error instanceof Error ? error.message : "Failed to analyze repo",
      },
      { status: 500 },
    );
  }
}
