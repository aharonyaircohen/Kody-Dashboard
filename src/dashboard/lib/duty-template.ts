/**
 * Default scaffold for a new job's markdown body.
 *
 * The system prompt is NOT authored per-job — it's a shared constant in
 * `job-prompt.ts` that the executor appends automatically. Each job
 * only describes its own intent, allowed commands, and restrictions.
 *
 * Three empty H2 sections — no hints, no placeholders. Authors type content
 * under each heading without ever deleting filler.
 */
export const JOB_TEMPLATE = `## Job


## Allowed Commands


## Restrictions

`;
