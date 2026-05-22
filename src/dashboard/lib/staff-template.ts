/**
 * Default scaffold for a new worker's markdown body.
 *
 * The system prompt is NOT authored per-worker — it's a shared constant in
 * `worker-prompt.ts` that the executor appends automatically. Each worker
 * only describes its own intent, allowed commands, and restrictions.
 *
 * Three empty H2 sections — no hints, no placeholders. Authors type content
 * under each heading without ever deleting filler.
 */
export const WORKER_TEMPLATE = `## Worker


## Allowed Commands


## Restrictions

`;
