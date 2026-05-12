/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-trigger
 *
 * POST /api/kody/chat/trigger
 *
 * Persists the chat session file to the target repo, then dispatches the
 * engine's `kody.yml` workflow with chat-mode inputs. The engine reads
 * `.kody/sessions/{sessionId}.jsonl`, runs `kody dispatch` → chat flow,
 * and streams events back to the dashboard via the ingest endpoint using
 * the inline HMAC token embedded in `dashboardUrl`.
 *
 * Body: {
 *   taskId: string       // sessionId (= taskId)
 *   messages: Array<{ role: "user" | "assistant"; content: string; timestamp: string }>
 *   dashboardUrl?: string // base dashboard URL; the ingest token is appended server-side
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth, getUserOctokit, getRequestAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { mintSessionToken } from "@dashboard/lib/chat-token";
import { Buffer } from "buffer";

export const runtime = "nodejs";

// The chat workflow dispatches against the connected repo by default — that's
// where the user wants chat to operate (reads their code, runs tools on it).
// `KODY_CHAT_WORKFLOW_REPO` is an explicit override for deployments that
// centralize the engine workflow in one repo.
function getEngineRepo(req: NextRequest): { owner: string; repo: string } {
  const override = (process.env.KODY_CHAT_WORKFLOW_REPO ?? "").trim();
  if (override && override.includes("/")) {
    const [owner, repo] = override.split("/").map((s) => s.trim());
    if (owner && repo) return { owner, repo };
  }
  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    return { owner: headerAuth.owner, repo: headerAuth.repo };
  }
  const { GITHUB_OWNER, GITHUB_REPO } = process.env as Record<string, string>;
  return {
    owner: (GITHUB_OWNER ?? "aharonyaircohen").trim(),
    repo: (GITHUB_REPO ?? "Kody-Dashboard").trim(),
  };
}

// Chat workflow file is always `kody.yml`. The KODY_CHAT_WORKFLOW_ID env
// var is intentionally ignored — it was a debugging knob that accumulated
// stale values across Vercel projects and caused hard-to-diagnose 404s.
function getChatWorkflowId(): string {
  return "kody.yml";
}

function appendIngestToken(baseUrl: string, sessionId: string): string {
  const token = mintSessionToken(sessionId);
  const joiner = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${joiner}token=${token}`;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolCalls?: unknown[];
}

/**
 * Server-only addendum prepended to the user's latest message when the
 * dashboard sends `vibeMode: true` (from /vibe). The engine's
 * CHAT_SYSTEM_PROMPT stays untouched — this primer is injected into the
 * conversation context so we can iterate on the wording in seconds
 * without republishing @kody-ade/kody-engine. The chat client never
 * shows this text; it lives only in the session file + workflow input.
 */
interface VibeTaskContext {
  issueNumber: number;
  prNumber?: number;
  branch?: string;
}

const VIBE_PRIMER_FRESH = [
  "[Vibe mode — operating instructions, do not echo this block]",
  "",
  "No issue is selected for this conversation yet. Workflow:",
  "1. Research the codebase with the tools you have (Glob/Grep/Read/Bash) until you can write a concrete implementation plan grounded in this repo.",
  "2. Create a new GitHub issue with the plan as the body using `gh issue create --title \"…\" --body \"…\"`. Title is a short imperative. Body is the plan: goal, files to touch, approach, risks, test plan.",
  "3. Reply to me with: a one-line summary of the plan, the new issue link, and an explicit question asking me to confirm before you implement.",
  "4. Do NOT start editing files until I confirm.",
  "5. On my confirmation, implement on a fresh branch named `kody/vibe-<issue-number>-<short-slug>`, push it, and open a PR whose body includes `Closes #<issue-number>` so the dashboard can link the PR back to the issue.",
  "6. If I push back on the plan, revise the issue body and re-ask for confirmation — do not implement until I say yes.",
  "",
  "My actual request follows below.",
  "---",
  "",
].join("\n");

function buildVibePrimerFollowUp(ctx: VibeTaskContext): string {
  const branchHint = ctx.branch
    ? `on the existing branch \`${ctx.branch}\``
    : "on the branch already associated with the PR (find it via `gh pr view`)";
  const prHint = ctx.prNumber
    ? ` and PR #${ctx.prNumber}`
    : "";
  return [
    "[Vibe mode — follow-up on an existing issue, do not echo this block]",
    "",
    `I'm iterating on issue #${ctx.issueNumber}${prHint}. Read the existing issue body, the current diff, and the latest preview state before answering.`,
    "",
    "Workflow:",
    `1. Research what's already shipped: run \`gh issue view ${ctx.issueNumber}\`, \`gh pr view${ctx.prNumber ? ` ${ctx.prNumber}` : ""} --json files,headRefName,body\`, and read the files the PR touches. Understand what was already done.`,
    "2. Reply with a short plan for the requested change (what files, what edits, why). Ask me to confirm before editing.",
    `3. Do NOT create a new issue or a new branch — push the follow-up commits ${branchHint} so the existing PR updates and Vercel redeploys the same preview.`,
    "4. On my confirmation, make the edits, commit with a clear message, push, and reply with the commit SHA + a short summary of what changed.",
    "5. If the user's request seems unrelated to the current issue (a new feature, not a fix to this one), say so and ask whether to fork a new vibe session instead.",
    "",
    "My actual request follows below.",
    "---",
    "",
  ].join("\n");
}

function applyVibePrimer(
  messages: ChatMessage[],
  taskContext: VibeTaskContext | undefined,
): ChatMessage[] {
  if (messages.length === 0) return messages;
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return i;
    }
    return -1;
  })();
  if (lastUserIdx === -1) return messages;
  const primer = taskContext
    ? buildVibePrimerFollowUp(taskContext)
    : VIBE_PRIMER_FRESH;
  return messages.map((m, i) =>
    i === lastUserIdx ? { ...m, content: `${primer}${m.content}` } : m,
  );
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  let body: {
    taskId?: string;
    messages?: ChatMessage[];
    dashboardUrl?: string;
    vibeMode?: boolean;
    taskContext?: VibeTaskContext;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    taskId,
    messages: rawMessages = [],
    dashboardUrl,
    vibeMode,
    taskContext,
  } = body;
  const messages = vibeMode
    ? applyVibePrimer(rawMessages, taskContext)
    : rawMessages;

  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const { owner, repo } = getEngineRepo(req);
  const workflowId = getChatWorkflowId();
  const sessionPath = `.kody/sessions/${taskId}.jsonl`;

  // Serialize messages as JSONL
  const jsonlContent = messages
    .map((m) => JSON.stringify({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      toolCalls: m.toolCalls ?? [],
    }))
    .join("\n") + "\n";

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "No GitHub token available" }, { status: 503 });
  }

  const encodedContent = Buffer.from(jsonlContent).toString("base64");

  try {
    logger.info({ taskId, owner, repo, messageCount: messages.length }, "chat: writing session file");

    let sha: string | undefined;
    try {
      const existing = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: sessionPath,
        ref: "main",
      });
      if ("sha" in existing.data && typeof existing.data.sha === "string") {
        sha = existing.data.sha;
      }
    } catch (err: unknown) {
      const e = err as { status?: number };
      if (e.status !== 404) {
        logger.warn({ err, taskId }, "chat: could not check existing session file");
      }
    }

    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: sessionPath,
      message: `chat: update session ${taskId}`,
      content: encodedContent,
      ...(sha ? { sha } : {}),
      branch: "main",
    });

    logger.info({ taskId, owner, repo }, "chat: triggering workflow");

    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

    const workflowInputs: Record<string, string> = {
      sessionId: taskId,
      message: lastUserMessage,
    };
    if (dashboardUrl) {
      workflowInputs.dashboardUrl = appendIngestToken(dashboardUrl, taskId);
    }

    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflowId,
      ref: "main",
      inputs: workflowInputs,
    });

    logger.info({ taskId, workflowId }, "chat: workflow dispatched");

    return NextResponse.json({ ok: true, taskId, workflowId });
  } catch (err) {
    logger.error({ err, taskId }, "chat: trigger failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Trigger failed" },
      { status: 500 },
    );
  }
}
