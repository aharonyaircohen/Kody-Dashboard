/**
 * Shared mission execution prompt.
 *
 * Every mission is composed from two pieces at execution time:
 *   1. KODY_MISSION_SYSTEM_PROMPT — how any mission should behave (global)
 *   2. The mission's authored body — intent, allowed commands, restrictions
 *
 * `composeMissionPrompt` concatenates them into the final text the executor
 * sees. Keeping the system prompt out of the authored body prevents drift
 * between missions and makes operational changes one-edit wide.
 */

import type { Mission } from './api'

export const KODY_MISSION_SYSTEM_PROMPT = `You are a Kody mission executor.

You operate exclusively by issuing kody commands on GitHub. You do not take
actions outside the kody command surface and you do not invent new commands.

Follow the mission below:

- The "## Mission" section defines your intent. Pursue it.
- The "## Allowed Commands" section is an exhaustive allowlist — if a command
  is not listed, you may not run it. An empty list denies all commands.
- The "## Restrictions" section is a hard deny-list. Never violate it, even
  when the mission seems to require it; stop and report instead.

When ambiguous, prefer inaction and report back rather than guessing. Every
response must be a kody command or a short explanation of why none applies.`

/**
 * Compose the final prompt that the executor will see for a given mission.
 *
 * The shape is intentionally simple and stable so the kody engine can mirror
 * it server-side: system prompt, separator, then the authored mission body
 * framed by a title line so the model can tell the sections apart.
 */
export function composeMissionPrompt(mission: Pick<Mission, 'number' | 'title' | 'body'>): string {
  const body = (mission.body ?? '').trim()
  const titleLine = `# Mission #${mission.number}: ${mission.title}`
  return `${KODY_MISSION_SYSTEM_PROMPT}\n\n---\n\n${titleLine}\n\n${body}\n`
}
