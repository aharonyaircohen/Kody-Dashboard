/**
 * @fileType utility
 * @domain kody
 * @pattern modality-overlay
 *
 * Shared voice-modality contract for every chat backend.
 *
 * Voice is a modality, not an agent — the user picks the brain in the
 * dropdown, and the same brain answers text and voice. The dashboard
 * just signals "this turn will be spoken" by setting `voiceMode: true`
 * on the chat request body; each backend route owns how it applies the
 * overlay (in-process prompt assembly for kody-direct, server-side
 * append for brain, etc.).
 *
 * Single source of truth for:
 * - the overlay prompt text (`VOICE_OVERLAY_PROMPT`)
 * - the append rule (`applyVoiceOverlay`)
 * - the wire schema (`VoiceModeBodySchema`)
 *
 * Backends MUST import from here rather than re-implementing the rule
 * — otherwise voice replies drift between agents.
 */

import { z } from 'zod'

/**
 * TTS-friendly rules appended to the FULL assembled system prompt
 * whenever `voiceMode === true`. Appended LAST so its formatting rules
 * win by recency over any research/issue-creation/memory blocks the
 * base prompt builder layered in.
 *
 * Bound deliberately to the speaker side: it doesn't mention tools,
 * memory, or persona — those are the base agent's job. The overlay
 * only reshapes OUTPUT.
 */
export const VOICE_OVERLAY_PROMPT = `## Voice mode (your reply will be read aloud)

Your reply is going straight into text-to-speech. Write it the way you would say it on a call. The rules below override any formatting guidance earlier in this prompt.

Voice rules (hard):
- No markdown. No bullets. No headings. No code fences. No tables. No asterisks or underscores for emphasis.
- No \`<think>\`, \`<thinking>\`, or any other inline thinking/scratchpad tags in your reply — the user only hears what you write here, so write the final answer directly. Reason silently.
- Short sentences. One idea per sentence. Prefer two sentences over one long one.
- Read symbols as words when reading code, paths, or URLs aloud: say "hash" not "#", "at" not "@", "dot" not ".", "slash" not "/", "dash" not "-".
- Say numbers the way a person says them: "PR forty-five" not "PR #45", "twelve thousand" not "12,000". Issue numbers can stay as digits ("issue 312").
- Never read JSON, diffs, raw logs, or stack traces aloud. Summarize them in one or two sentences and offer details if asked.
- If there are more than three items, give the count and the top one or two. Offer to read more if the user asks.
- No preambles. No "Sure!", no "Here's what I found", no capability rundowns. Get to the answer in the first sentence.
- If a file path or URL is essential, say it once, slowly, then move on. Don't repeat it.
- If the user asks for something visual (a diagram, a table, a screenshot), say it's better seen on screen and give the gist out loud.

Tone:
- Conversational and direct, like a teammate on a call.
- One short clarifying question is fine. Two is not.
- Never narrate "calling tool X" or "let me check". Just do it and speak the result.

Keep replies tight. The user is listening, not reading.`

/**
 * Append the voice overlay to a fully-assembled system prompt. The
 * overlay goes LAST so its rules override the markdown-heavy guidance
 * earlier in the prompt (research-first blocks, issue-creation
 * templates, memory index, etc.). When `voiceMode` is false the input
 * is returned unchanged.
 */
export function applyVoiceOverlay(
  basePrompt: string,
  voiceMode: boolean,
): string {
  if (!voiceMode) return basePrompt
  return `${basePrompt}\n\n${VOICE_OVERLAY_PROMPT}`
}

/**
 * Zod schema fragment every chat backend can mix into its body schema
 * to pick up `voiceMode` validation consistently. Optional + defaults
 * to false so existing clients keep working unchanged.
 */
export const VoiceModeBodySchema = z.object({
  voiceMode: z.boolean().optional().default(false),
})

export type VoiceModeBody = z.infer<typeof VoiceModeBodySchema>
