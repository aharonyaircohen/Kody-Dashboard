/**
 * Default scaffold for a new agentResponsibility's markdown body.
 *
 * The system prompt is NOT authored per-agentResponsibility — it's a shared constant in
 * `agentResponsibility-prompt.ts` that the executor appends automatically. Each agentResponsibility
 * only describes its own intent, allowed commands, and restrictions.
 *
 * Three empty H2 sections — no hints, no placeholders. Authors type content
 * under each heading without ever deleting filler. The `## Job` /
 * `## Allowed Commands` / `## Restrictions` headings are parsed by the
 * engine's agent-responsibility-tick executor, so their text is a contract — do not rename.
 */
import { buildDefaultAgentResponsibilityBody } from "./agent-responsibilities/output";

export const DUTY_TEMPLATE = buildDefaultAgentResponsibilityBody();
