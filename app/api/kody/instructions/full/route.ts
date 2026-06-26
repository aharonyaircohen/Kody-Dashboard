/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern instructions-full-api
 * @ai-summary Returns the full assembled system prompt that the
 *   in-process Kody agent would receive on a NEUTRAL chat turn —
 *   base agent prompt + connected-repo block + research-first
 *   rules + memory index + user instructions overlay. Per-turn
 *   blocks (current task, capability, vibe, voice overlay) are excluded
 *   because they only exist in the context of a live chat session.
 *
 *   This is read-only debug visibility for the /instructions page.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { AGENT_KODY } from "@dashboard/lib/agents";
import { buildSystemPrompt } from "../../chat/kody/system-prompt";
import { loadMemoryIndexForPrompt } from "@dashboard/lib/memory-files";
import { loadInstructionsForPrompt } from "@dashboard/lib/instructions/files";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const repo = getRequestAuth(req);
  if (!repo) {
    return NextResponse.json(
      { prompt: AGENT_KODY.systemPrompt },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  setGitHubContext(repo.owner, repo.repo, repo.token);
  try {
    const [memoryIndex, userInstructions] = await Promise.all([
      loadMemoryIndexForPrompt().catch(() => null),
      loadInstructionsForPrompt().catch(() => null),
    ]);
    const prompt = buildSystemPrompt(
      AGENT_KODY.systemPrompt,
      { owner: repo.owner, repo: repo.repo },
      undefined,
      {
        memoryIndex,
        userInstructions,
      },
    );
    return NextResponse.json({ prompt }, { headers: NO_STORE_HEADERS });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message || "Failed to assemble prompt" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}
