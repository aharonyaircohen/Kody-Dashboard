# Task 325 — Merge conflict resolution

PR #325 (`322-release-verification-chat-trigger`) conflicted with `origin/main`
on 2 files. Resolved by taking the `origin/main` side for every conflict.

## Context

Merge base: `20667e45` (chore(release): prepare v0.1.1102).

Main brought in 3 substantial commits since the base:
- `d3b4ced5` feat(chat): per-session agent selection
- `65452b9a` refactor(chat): chat-defaults bundle (replaces AGENT_KODY.systemPrompt)
- `3e1bb0b3` chore: feat(chat): tool descriptions in Kody Direct thinking panel

The PR's only unique change is `4b235927` (docs formatting). HEAD-side code
predates the main refactors — `AGENT_SOURCE` no longer exists, the
`writeDefaultChatEntry` picker path was replaced with `setSessionAgent`,
`createSession` gained an `{ agentKey }` seed option, and tool calls gained
a `description` field.

## Resolutions

- `src/dashboard/lib/components/KodyChat.tsx` x3 — took main: per-session
  picker persistence, seeded new-session with current agent, tool call
  description prop.
- `tests/unit/duty-creation-guide.spec.ts` x1 — took main: load chat-defaults
  bundle and inspect the `create-duty` skill body.

## Verification

- `pnpm typecheck` — passes.
- `pnpm test` — 1516 passed, 9 skipped (3 unrelated int tests skipped).
- `pnpm lint` — 0 errors (pre-existing warnings only).
- `pnpm prettier --check` — pre-existing format issues on origin/main; not
  introduced by this resolution.
