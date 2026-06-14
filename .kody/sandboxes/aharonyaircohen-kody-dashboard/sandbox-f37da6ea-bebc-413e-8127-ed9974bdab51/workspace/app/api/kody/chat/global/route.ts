/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-global-persistence
 *
 * GET  /api/kody/chat/global?sessionId=...
 *   Read `.kody/chat/global.json` from the repo's default branch as a
 *   fallback when localStorage is empty (e.g. fresh device, cleared cache).
 *   Returns `{ messages: ChatMessage[] }` or `{ messages: [] }` when no
 *   persisted conversation exists.
 *
 * POST /api/kody/chat/global
 *   Body: { sessionId, messages }
 *   Writes the active global session's messages to
 *   `.kody/chat/global.json` on the default branch. Gated to ONCE per
 *   24h per sessionId so the dashboard can ship a "save snapshot"
 *   ping after every turn without flooding the repo with commits.
 *   Skipped when:
 *     - the sessionId is missing
 *     - the messages array is empty
 *     - the count + last-message fingerprint matches the last write
 *     - a write already landed within the last 24h for this sessionId
 *   The gate is tracked in `.kody/chat/last-written.json` (a tiny
 *   `{ [sessionId]: isoTimestamp }` map).
 *
 * The unified chat thread (issue #66) lives primarily in
 * `useChatSessions("global")` → localStorage. This route is a
 * cross-device fallback, not the source of truth — writes are sparse
 * and reads are best-effort.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  requireKodyAuth,
  getRequestAuth,
  getUserOctokit,
} from "@dashboard/lib/auth";
import {
  getOctokit,
  setGitHubContext,
  clearGitHubContext,
  getOwner,
  getRepo,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GLOBAL_FILE = ".kody/chat/global.json";
const GATE_FILE = ".kody/chat/last-written.json";
const GATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

const postSchema = z.object({
  sessionId: z.string().min(1).max(200),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string(),
      timestamp: z.string().optional(),
    }),
  ),
});

interface LastWrittenMap {
  [sessionId: string]: string; // ISO timestamp
}

interface PersistedGlobalChat {
  version: 1;
  sessionId: string;
  updatedAt: string;
  messages: Array<{
    role: "user" | "assistant";
    text: string;
    timestamp: string;
  }>;
}

async function readFileSha(
  octokit: ReturnType<typeof getOctokit>,
  path: string,
  ref: string,
): Promise<{ sha: string; contentBase64: string | null } | null> {
  try {
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path,
      ref,
    });
    if ("content" in data) {
      return { sha: data.sha, contentBase64: data.content ?? null };
    }
    return null;
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return null;
    throw err;
  }
}

function decodeBase64Utf8(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf-8");
}

function encodeBase64Utf8(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

/**
 * Cheap fingerprint for "did anything change since the last write?"
 * We compare message count + the text of the last message — good enough
 * to skip the common case where the user re-pings the same tail of the
 * conversation.
 */
function fingerprint(messages: ReadonlyArray<{ text: string }>): string {
  if (messages.length === 0) return "0:";
  const last = messages[messages.length - 1]?.text ?? "";
  return `${messages.length}:${last.slice(0, 200)}`;
}

function withinGate(lastIso: string | undefined, now: number): boolean {
  if (!lastIso) return false;
  const t = Date.parse(lastIso);
  if (Number.isNaN(t)) return false;
  return now - t < GATE_WINDOW_MS;
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const sessionId = req.nextUrl.searchParams.get("sessionId") ?? "";
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    const octokit = getOctokit();
    const repoMeta = await octokit.repos.get({
      owner: getOwner(),
      repo: getRepo(),
    });
    const defaultBranch = repoMeta.data.default_branch || "main";

    const file = await readFileSha(octokit, GLOBAL_FILE, defaultBranch);
    if (!file?.contentBase64) {
      return NextResponse.json({ messages: [] });
    }

    try {
      const parsed = JSON.parse(
        decodeBase64Utf8(file.contentBase64),
      ) as PersistedGlobalChat;
      return NextResponse.json({
        messages: parsed.messages ?? [],
        sessionId: parsed.sessionId,
        updatedAt: parsed.updatedAt,
      });
    } catch (err) {
      logger.warn({ err }, "[chat-global] persisted file is not valid JSON");
      return NextResponse.json({ messages: [] });
    }
  } catch (err) {
    logger.error({ err }, "[chat-global] GET failed");
    return NextResponse.json(
      { error: "Failed to load global chat" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const body = await req.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message },
        { status: 400 },
      );
    }
    const { sessionId, messages } = parsed.data;

    if (messages.length === 0) {
      return NextResponse.json({ success: true, skipped: "empty" });
    }

    const readOctokit = getOctokit();
    const userOctokit = await getUserOctokit(req);
    const writeOctokit = userOctokit ?? readOctokit;

    const repoMeta = await readOctokit.repos.get({
      owner: getOwner(),
      repo: getRepo(),
    });
    const defaultBranch = repoMeta.data.default_branch || "main";
    const now = Date.now();

    // 24h gate — read the gate file, decide if we can write.
    const gateFile = await readFileSha(readOctokit, GATE_FILE, defaultBranch);
    let gate: LastWrittenMap = {};
    if (gateFile?.contentBase64) {
      try {
        gate = JSON.parse(decodeBase64Utf8(gateFile.contentBase64));
      } catch {
        gate = {};
      }
    }
    if (withinGate(gate[sessionId], now)) {
      return NextResponse.json({ success: true, skipped: "gated-24h" });
    }

    // Read existing global.json for content-identity skip + sha.
    const globalFile = await readFileSha(
      readOctokit,
      GLOBAL_FILE,
      defaultBranch,
    );

    const fingerprintNew = fingerprint(messages);
    if (globalFile?.contentBase64) {
      try {
        const existing = JSON.parse(
          decodeBase64Utf8(globalFile.contentBase64),
        ) as PersistedGlobalChat;
        if (
          existing.sessionId === sessionId &&
          fingerprint(existing.messages) === fingerprintNew
        ) {
          return NextResponse.json({ success: true, skipped: "unchanged" });
        }
      } catch {
        /* fall through and rewrite */
      }
    }

    const payload: PersistedGlobalChat = {
      version: 1,
      sessionId,
      updatedAt: new Date(now).toISOString(),
      messages: messages.map((m) => ({
        role: m.role,
        text: m.text,
        timestamp: m.timestamp ?? new Date(now).toISOString(),
      })),
    };
    const content = encodeBase64Utf8(JSON.stringify(payload, null, 2));

    await writeOctokit.repos.createOrUpdateFileContents({
      owner: getOwner(),
      repo: getRepo(),
      path: GLOBAL_FILE,
      message: `kody: persist global chat (${sessionId.slice(0, 12)}, ${messages.length} msg)`,
      content,
      branch: defaultBranch,
      sha: globalFile?.sha,
    });

    // Bump the gate.
    gate[sessionId] = new Date(now).toISOString();
    const gateContent = encodeBase64Utf8(JSON.stringify(gate, null, 2));
    await writeOctokit.repos.createOrUpdateFileContents({
      owner: getOwner(),
      repo: getRepo(),
      path: GATE_FILE,
      message: `kody: bump global-chat write gate (${sessionId.slice(0, 12)})`,
      content: gateContent,
      branch: defaultBranch,
      sha: gateFile?.sha,
    });

    return NextResponse.json({ success: true, written: messages.length });
  } catch (err) {
    logger.error({ err }, "[chat-global] POST failed");
    return NextResponse.json(
      { error: "Failed to save global chat" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
