Added Wake Lock API support to `useVoiceChat.ts` (single file change).

Key decisions:
- `WakeLockSentinel` held in a `useRef` so it survives re-renders without causing re-renders.
- `acquireWakeLock` and `releaseWakeLock` are `useCallback` wrappers so they can be added to the dependency arrays of the callbacks that use them.
- Silent fallback: if Wake Lock is unsupported or denied, `request()` throws and we catch it — no user-facing error.
- Visibility re-acquisition: added a `visibilitychange` listener that re-acquires the wake lock if the page becomes visible again while a conversation is active (state !== "idle"). This handles the case where the OS releases the lock when the tab goes to the background.
- `releaseWakeLock` added to the unmount cleanup effect (was previously absent from deps array).
