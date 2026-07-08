/**
 * @fileType data
 * @domain chat-platform
 * @pattern transport-envelope
 * @ai-summary Zod schemas for the wire payloads the transport adapters
 *   parse (phase-1 hardening M5.2). Two families: brain SSE events
 *   (`chat.message` / `chat.tool_use` / `chat.done` / `chat.error` /
 *   `chat.reconnect`) and kody-direct AI SDK UI chunks (`text-delta`,
 *   `tool-input-available`, …). Corrupt chunks are SKIPPED, never thrown
 *   — matching the historical per-branch behavior where a malformed SSE
 *   line was swallowed and the stream kept going. Field-level `.catch()`
 *   keeps single mistyped fields from discarding an otherwise-valid
 *   event (the pre-zod typeof guards behaved per-field, not per-event).
 */

import { z } from "zod";

const lenientString = z.string().optional().catch(undefined);
const lenientNumber = z.number().optional().catch(undefined);
const lenientRecord = z
  .record(z.string(), z.unknown())
  .optional()
  .catch(undefined);

/**
 * One brain SSE event. Every field optional + lenient: the pre-zod code
 * accessed fields behind typeof guards, so a wrong-typed field degraded
 * to "absent" rather than dropping the event.
 */
export const brainWireEventSchema = z.object({
  type: lenientString,
  role: lenientString,
  content: lenientString,
  timestamp: lenientString,
  error: lenientString,
  id: lenientString,
  name: lenientString,
  input: lenientRecord,
  seq: lenientNumber,
});

export type BrainWireEvent = z.infer<typeof brainWireEventSchema>;

/**
 * Parse the JSON payload of one brain SSE `data: ` line. Returns null for
 * malformed JSON or non-object payloads — the caller skips the line, which
 * is byte-for-byte the old `try { applyEvent(JSON.parse(raw)) } catch {}`
 * behavior (primitives no-op'd, null threw-and-was-swallowed).
 */
export function parseBrainWireEvent(raw: string): BrainWireEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = brainWireEventSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * One kody-direct AI SDK UI chunk. `type` is the discriminator; the rest
 * are the union of fields across chunk kinds. Unknown `type` values parse
 * fine and no-op in the adapter — exactly like the old `| { type: string }`
 * fallthrough arm.
 */
export const kodyDirectChunkSchema = z.object({
  type: z.string().catch(""),
  delta: lenientString,
  errorText: lenientString,
  /** `data-tools-index` payload: name → description (values re-checked). */
  data: lenientRecord,
  toolCallId: lenientString,
  toolName: lenientString,
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});

export type KodyDirectChunk = z.infer<typeof kodyDirectChunkSchema>;

/**
 * Parse the JSON payload of one kody-direct SSE event. Returns null for
 * malformed JSON or non-object payloads — caller skips the chunk (the old
 * behavior: `catch { /* ignore malformed chunks *\/ }`).
 */
export function parseKodyDirectChunk(raw: string): KodyDirectChunk | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = kodyDirectChunkSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
