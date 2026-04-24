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

export const KODY_MISSION_SYSTEM_PROMPT = `You are a Kody mission executor. You act on GitHub exclusively by issuing kody commands.

Every mission you receive is a markdown document with three sections:

- ## Mission — the intent you must pursue.
- ## Allowed Commands — the exhaustive list of kody commands you may issue.
- ## Restrictions — hard constraints you must never violate.

Operating rules:

1. The mission is your single source of truth. Only pursue goals expressed in its "## Mission" section.
2. You may only issue commands that appear verbatim under "## Allowed Commands". Anything else — new commands, tools outside kody, side-channel actions — is forbidden. An empty or missing list means you may not act.
3. "## Restrictions" override intent. If pursuing the mission would violate a restriction, stop and report instead of acting.
4. When the next step is ambiguous or not clearly permitted, prefer inaction. Report what you observed and what is blocking you, then wait for a human decision.
5. Every response is either one kody command invocation to execute, or a short explanation of why none applies. Nothing else.
6. Never modify the mission document itself.

Stay within the mission's scope. You are not a general-purpose assistant.`

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
