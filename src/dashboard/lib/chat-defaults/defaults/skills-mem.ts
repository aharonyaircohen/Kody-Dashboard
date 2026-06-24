/**
 * memory — persistent notes management.
 * Source: AGENT_KODY.systemPrompt § "Memory".
 */

import type { SkillEntry } from "./types";

export const DEFAULT_SKILL_MEMORY: SkillEntry = {
  slug: "memory",
  title: "memory",
  body: `\`.kody/memory/\`. INDEX injected under "## Remembered context"; apply automatically.

**Memory tools:**
- \`recall(id)\` — full body of one memory entry.
- \`recall_search(query)\` — search every memory file's body via GitHub code search (use when the index is truncated or the hook you need isn't there).
- \`list_memories\` — enumerate all entries (use when you want a full inventory, e.g. before deciding whether a new memory is a duplicate).
- \`update_memory\` — replace an existing entry (use when the new fact supersedes an old one, never to write a duplicate of an existing entry).
- \`remember\` — write a new entry. Required whenever a trigger below fires.

When any of the triggers below fire, you MUST invoke the \`remember\` tool in this same turn. Acknowledging the user in chat is NOT enough — without a tool call, the preference vanishes next session. "I'll remember that" without a \`remember\` tool call = bug.

**Triggers:**
- Explicit memory command ("remember X", "store this", "save this for later") → choose \`feedback\` / \`project\` / \`user\` / \`reference\` by content.
- Correction (e.g. "stop doing X", "don't do Y", "no, do Z instead") → \`feedback\`. Body MUST include **Why:** + **How to apply:**.
- Confirmation of non-obvious choice → \`feedback\`, same shape.
- Project fact not in code/git → \`project\`. Absolute dates only.
- External pointer (Linear, Grafana) → \`reference\`.
- User profile (role, expertise, style) → \`user\`.

**Don't write:** derivable patterns / paths / architecture, git history, anything in CLAUDE.md, ephemeral state, duplicates (\`update_memory\`).

**Write freely during the first few turns of a new repo relationship.** Memories are how the model learns the user's project context and preferences. In the first 5–10 turns, lean toward writing on corrections, confirmations of non-obvious choices, and unmissable project facts. Once the user has accumulated 5–10 memories and the model has a working picture, throttle back to corrections + unmissable confirmations only.

**Hygiene:** silent saves (no mid-reply announcement); \`description\` specific; trust observation over stale memory. Read the index before writing a new memory — if a similar entry exists, call \`update_memory\` instead.`,
};
