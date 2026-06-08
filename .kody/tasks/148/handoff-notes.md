Fixed issue #148 — voice mode still dims the screen on Android Chrome ~30s into a conversation.

Root cause: two related gaps in `src/dashboard/lib/hooks/useVoiceChat.ts`. (1) The `visibilitychange` handler called `navigator.wakeLock.request("screen")` synchronously, which races Chrome's user-gesture check on Android and throws `NotAllowedError` — the re-acquire is silently swallowed and the OS dims the screen ~30s later. (2) `resumeConversation` never re-armed the lock, so a Pause → Resume cycle left the screen unlocked.

Fix: defer the visibility-change re-acquire by 100ms with a setTimeout and re-check `wakeLockRef.current` + `stateRef.current` inside the tick (covers the case where the user stopped the conversation in the gap). Also call `acquireWakeLock()` from `resumeConversation` (added `acquireWakeLock` to its dep array).

Test: new source-level spec at `tests/unit/chat/voice-wake-lock.spec.ts` (mirrors the `preview-actions-merge-button.spec.ts` pattern — the hook is too browser-heavy for a node-environment vitest, no `@testing-library/react` in the repo). It was red on the original code (3 failures for the right reasons) and green after the fix. All 1292 tests pass, verify gate green (typecheck/lint/format/tests).

Outstanding: per the `voice-wake-lock-recurring` project memory, the fix still needs verification on a real Android Chrome device before the bug is closed — node-env unit tests can't observe the WakeLockSentinel behavior. Logged in `followups.json`.
