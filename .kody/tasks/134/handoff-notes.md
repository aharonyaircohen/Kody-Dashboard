Fixed issue #134 — "Chat creates a hidden Live runner on dashboard open, before the user picks an agent."

Root cause: the chat composer's `selectedAgentId` defaults to `"kody-live"` (a long-lived GitHub Actions runner), but `buildAgentList` deliberately omitted Live from the dropdown. The picker was a lie: it showed "Brain / Brain-Fly / kody:<model>" while the chat was actually pointing at Live. The dispatch path itself was already correct (no mount effect, no rehydrate branch ever calls `/api/kody/chat/interactive/start`). The "hidden Live runner" was a UX bug masquerading as a dispatch bug — a Live runner would only start when the user picked Live from the (invisible) picker or typed and sent (the existing first-turn auto-start), so the user couldn't see the cause.

Fix: include Live (or `kody-live-fly` when the repo has `FLY_API_TOKEN`) as the first row in `buildAgentList`, so the visible picker matches the actual default. Same function is also used by `DefaultChatCard` (Settings) so the change is consistent.

Tests added (7 new, 4 updated):

- `tests/unit/chat-agent-entries.spec.ts` — new `issue #134` describe block pinning the Live-always-present contract. Updated existing assertions to use `byKey.has()` / `byKey.get()` so they survive any reordering.
- `tests/unit/chat/kody-chat-no-auto-dispatch.spec.ts` — new source-level structural guard (matches the existing `kody-chat-composer.spec.ts` pattern). Walks every `useEffect` in `KodyChat.tsx` and pins that mount effects never call `startInteractiveSession`, and that `rehydrateForScope` never dispatches in any branch. Three tests: mount-effect guard, no-saved-session rehydrate guard, belt-and-suspenders full-callback guard.

Verify gate: typecheck 0 errors, lint 0 errors (131 pre-existing warnings), format:check clean, vitest 1252 passed / 10 skipped (was 1245; +7). PR opened: https://github.com/aharonyaircohen/Kody-Dashboard/pull/145
