/**
 * Default scaffold for a new duty's markdown body.
 *
 * The system prompt is NOT authored per-duty — it's a shared constant in
 * `duty-prompt.ts` that the executor appends automatically. Each duty
 * only describes its own intent, allowed commands, and restrictions.
 *
 * Three empty H2 sections — no hints, no placeholders. Authors type content
 * under each heading without ever deleting filler. The `## Job` /
 * `## Allowed Commands` / `## Restrictions` headings are parsed by the
 * engine's job-tick executor, so their text is a contract — do not rename.
 */
export const DUTY_TEMPLATE = `## Job


## Allowed Commands


## Restrictions

`;
