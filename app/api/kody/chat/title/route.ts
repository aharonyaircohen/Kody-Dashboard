/**
 * One-shot conversation titler.
 *
 * The global chat sidebar used to title a session by slicing the first
 * 48 chars of the opening user message — legible but not a real title.
 * This route asks the user's configured chat model for a short, human
 * summary instead. It reuses `resolveChatModel` so it always tracks the
 * same model/key/protocol resolution as the streaming chat route.
 *
 * Best-effort by contract: any failure returns a non-2xx and the client
 * keeps its local slice fallback, so titling never blocks the chat.
 */
import { NextRequest, NextResponse } from "next/server";
import { generateText, type ModelMessage } from "ai";
import { requireKodyAuth } from "@dashboard/lib/auth";
import { stripReasoning } from "@dashboard/lib/chat/core/reasoning";
import { resolveChatModel } from "../resolve-model";

export const runtime = "nodejs";

type WireMessage = { role: "user" | "assistant"; content: string };

const MAX_MESSAGES = 8;
const MAX_CHARS_PER_MESSAGE = 1200;
const MAX_TITLE_LEN = 60;

const SYSTEM_PROMPT =
  "You write short, specific titles for chat conversations. " +
  "Given the conversation so far, reply with ONLY a 3-6 word title " +
  "that captures what the user is trying to do. No quotes, no trailing " +
  "punctuation, no preamble — just the title.";

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  let body: { messages?: WireMessage[]; model?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const trimmed: ModelMessage[] = incoming
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(0, MAX_MESSAGES)
    .map((m) => ({
      role: m.role,
      // Defensively strip <think> reasoning server-side too — a title
      // should reflect intent, never the model's scratchpad.
      content: stripReasoning(m.content).slice(0, MAX_CHARS_PER_MESSAGE),
    }))
    .filter((m) => m.content.length > 0);

  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "messages required (non-empty)" },
      { status: 400 },
    );
  }

  const resolution = await resolveChatModel(req, body.model);
  if ("error" in resolution) return resolution.error;

  try {
    const { text } = await generateText({
      model: resolution.model,
      system: SYSTEM_PROMPT,
      messages: trimmed,
      maxOutputTokens: 24,
      temperature: 0.3,
    });
    // Models sometimes wrap the title in quotes or add a period despite
    // the instruction — normalize defensively.
    const cleaned = text
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.\s]+$/, "")
      .replace(/\s+/g, " ")
      .trim();

    // Reject reasoning-style runaways: a thinking model can ignore the
    // instruction and emit chain-of-thought ("The user just said hi…").
    // A real title is short and clause-free — anything longer or that
    // reads like a sentence is a 502 so the client uses its fallback.
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    const looksLikeReasoning =
      wordCount > 9 || /\b(the user|i need|let me|i should)\b/i.test(cleaned);
    if (!cleaned || looksLikeReasoning) {
      return NextResponse.json({ error: "unusable_title" }, { status: 502 });
    }

    const title = cleaned.slice(0, MAX_TITLE_LEN).trim();
    return NextResponse.json({ title });
  } catch (err) {
    return NextResponse.json(
      {
        error: "title_generation_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
