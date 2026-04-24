/**
 * Default scaffold for a new mission's markdown body.
 *
 * The system prompt is NOT authored per-mission — it's a shared constant in
 * `mission-prompt.ts` that the executor appends automatically. Each mission
 * only describes its own intent, allowed commands, and restrictions.
 *
 * Three empty H2 sections — no hints, no placeholders. Authors type content
 * under each heading without ever deleting filler.
 */
export const MISSION_TEMPLATE = `## Mission


## Allowed Commands


## Restrictions

`
