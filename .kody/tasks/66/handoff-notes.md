# Issue #66 — Unify chat thread across dashboard pages

Replaced three parallel per-scope message stores (`taskMessages`,
`draftMessages`/`jobMessagesBySlug`, `plannerMessagesBySession`) in
`KodyChat.tsx` with a single read/write through `useChatSessions("global")`.
The page/scope (task, duty, planner, report) now flows through the per-turn
system-prompt blocks in `app/api/kody/chat/kody/system-prompt.ts` — the
unified thread is the contract.

Key changes:

- `KodyChat.tsx`: `messages` / `setMessages` now wrap `sessionHook.messages`
  with the `chatToMessage` / `messageToChat` converters. Removed the
  load/save/migrate/clear effects and the issue-creation transfer block
  (`saveTaskChatLocal` + POST to `/api/kody/chat/save`). Added a
  `+` "New conversation" header button wired to `sessionHook.createSession()`.
- `app/api/kody/chat/global/route.ts` (new): GET reads
  `.kody/chat/global.json` from the default branch as a cross-device
  fallback. POST writes the active global session gated to ONCE per 24h
  per sessionId, tracked in `.kody/chat/last-written.json`. Empty
  messages and content-identity matches are skipped.
- Deleted: `src/dashboard/lib/task-chat-local.ts`,
  `src/dashboard/lib/duty-chat-local.ts`, `app/api/kody/chat/save/route.ts`,
  `app/api/kody/chat/load/route.ts`.
- Tests: rewrote `vibe-chat-transfer.spec.ts` to assert the unified
  thread (messages stay in `kody-sessions-v3:<owner>/<repo>`, no
  `kody-task-chat-*` key is written, runner kickoff still fires).
  Updated `vibe-scope-flip.spec.ts` and `vibe-repro-session-deleted.spec.ts`
  to mock the new global route and read from the global session.

Scope plumbing (`useChatScope().setScope(...)` calls, `getLiveScopeKey()`,
the system-prompt `## current ...` blocks) was deliberately untouched.
The kody-direct backend (`/api/kody/chat/kody`) now sends the global
session's messages automatically because `kodyMessages` is derived
from the now-unified `messages` state.
