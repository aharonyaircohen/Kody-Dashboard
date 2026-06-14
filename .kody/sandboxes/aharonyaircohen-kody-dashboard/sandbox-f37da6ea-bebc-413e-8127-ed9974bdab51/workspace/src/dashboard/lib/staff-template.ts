/**
 * Default scaffold for a new staff member's markdown body.
 *
 * The system prompt is NOT authored per-staff-member — it's a shared
 * constant in `staff-prompt.ts` that the executor appends automatically.
 * Each staff member only describes its own intent, allowed commands, and
 * restrictions.
 *
 * Three empty H2 sections — no hints, no placeholders. Authors type content
 * under each heading without ever deleting filler.
 */
export const STAFF_TEMPLATE = `## Staff


## Allowed Commands


## Restrictions

`;
