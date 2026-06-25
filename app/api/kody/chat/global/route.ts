/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-global-persistence
 *
 * GET  /api/kody/chat/global?sessionId=...
 *   Read `chat/global.json` from the configured Kody state repo as a
 *   fallback when localStorage is empty (e.g. fresh device, cleared cache).
 *   Returns `{ messages: ChatMessage[] }` or `{ messages: [] }` when no
 *   persisted conversation exists.
 *
 * POST /api/kody/chat/global
 *   Body: { sessionId, messages }
 *   Writes the active global session's messages to
 *   `chat/global.json` in the configured Kody state repo. Gated to ONCE per
 *   24h per sessionId so the dashboard can ship a "save snapshot"
 *   ping after every turn without flooding the repo with commits.
 *   Skipped when:
 *     - the sessionId is missing
 *     - the messages array is empty
 *     - the count + last-message fingerprint matches the last write
 *     - a write already landed within the last 24h for this sessionId
 *   The gate is tracked in `chat/last-written.json` (a tiny
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
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GLOBAL_FILE = "chat/global.json";
const GATE_FILE = "chat/last-written.json";
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
): Promise<{ sha: string; content: string | null } | null> {
  const file = await readStateText(octokit, getOwner(), getRepo(), path);
  if (!file) return null;
  return { sha: file.sha, content: file.content };
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
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );
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
    const file = await readFileSha(octokit, GLOBAL_FILE);
    if (!file?.content) {
      return NextResponse.json({ messages: [] });
    }

    try {
      const parsed = JSON.parse(file.content) as PersistedGlobalChat;
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
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );
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

    const now = Date.now();

    // 24h gate — read the gate file, decide if we can write.
    const gateFile = await readFileSha(readOctokit, GATE_FILE);
    let gate: LastWrittenMap = {};
    if (gateFile?.content) {
      try {
        gate = JSON.parse(gateFile.content);
      } catch {
        gate = {};
      }
    }
    if (withinGate(gate[sessionId], now)) {
      return NextResponse.json({ success: true, skipped: "gated-24h" });
    }

    // Read existing global.json for content-identity skip + sha.
    const globalFile = await readFileSha(readOctokit, GLOBAL_FILE);

    const fingerprintNew = fingerprint(messages);
    if (globalFile?.content) {
      try {
        const existing = JSON.parse(globalFile.content) as PersistedGlobalChat;
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
    const content = JSON.stringify(payload, null, 2);

    await writeStateText({
      octokit: writeOctokit,
      owner: getOwner(),
      repo: getRepo(),
      path: GLOBAL_FILE,
      message: `kody: persist global chat (${sessionId.slice(0, 12)}, ${messages.length} msg)`,
      content,
      sha: globalFile?.sha,
      maxAttempts: 1,
    });

    // Bump the gate.
    gate[sessionId] = new Date(now).toISOString();
    const gateContent = JSON.stringify(gate, null, 2);
    await writeStateText({
      octokit: writeOctokit,
      owner: getOwner(),
      repo: getRepo(),
      path: GATE_FILE,
      message: `kody: bump global-chat write gate (${sessionId.slice(0, 12)})`,
      content: gateContent,
      sha: gateFile?.sha,
      maxAttempts: 1,
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
