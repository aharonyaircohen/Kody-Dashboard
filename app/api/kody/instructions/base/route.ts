/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern instructions-base-api
 * @ai-summary Returns the read-only base system prompt for the in-process
 *   Kody agent (`AGENT_KODY.systemPrompt`). Surfaced behind the "View base
 *   prompt" button on /instructions so users can see what their overlay
 *   is layered on top of. Auth-gated but does not need a repo context —
 *   the base prompt is identical across repos.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireKodyAuth } from "@dashboard/lib/auth"
import { AGENT_KODY } from "@dashboard/lib/agents"

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult
  return NextResponse.json({ prompt: AGENT_KODY.systemPrompt })
}
