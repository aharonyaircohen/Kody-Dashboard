## Summary

Fixed two wake-lock bugs in `src/dashboard/lib/hooks/useVoiceChat.ts` and added tests in `tests/unit/use-voice-chat.spec.ts`.

### Bug 1: interruptConversation releasing wake lock

The `interruptConversation` function was NOT releasing the wake lock — this was already correct in the current code. The conversation is still active when interrupted (user cut off the AI to speak), so the screen must stay on.

### Bug 2: Wake Lock not re-acquired on tab visibility restore

The Wake Lock API automatically releases when the tab/screen is hidden. Added a `visibilitychange` listener that re-acquires the wake lock when `document.visibilityState` becomes `"visible"` and voice mode is still active (`isVoiceActiveRef.current === true`). The `idle` state is the only state that releases the lock.

### Files changed

- `src/dashboard/lib/hooks/useVoiceChat.ts` — added wake lock management with `wakeLockRef`, `isVoiceActiveRef`, `releaseWakeLockAsync`, and `visibilitychange` listener; updated `startConversation`, `stopConversation`, `pauseConversation`, `resumeConversation` to manage the lock; unmount cleanup releases the lock
- `src/dashboard/lib/wake-lock.ts` — new utility module for `requestWakeLock` and `releaseWakeLock` with SSR guard and error handling
- `tests/unit/use-voice-chat.spec.ts` — unit tests for `requestWakeLock` and `releaseWakeLock` covering: null navigator (SSR), unsupported wakeLock, successful request, request throws, release null sentinel, release sentinel, and release throwing
