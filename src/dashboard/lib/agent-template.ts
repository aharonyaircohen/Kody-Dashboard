/**
 * Default scaffold for a new agent's markdown body.
 *
 * The system prompt is NOT authored per-agent-member — it's a shared
 * constant in `agent-prompt.ts` that the executor appends automatically.
 * Each agent only describes its own intent, allowed commands, and
 * restrictions.
 *
 * Three empty H2 sections — no hints, no placeholders. Authors type content
 * under each heading without ever deleting filler.
 */
export const AGENT_TEMPLATE = `## Agent


## Allowed Commands


## Restrictions

`;
