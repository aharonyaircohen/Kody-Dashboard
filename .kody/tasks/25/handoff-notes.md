## What

Added Wake Lock API support to `useVoiceChat.ts` to keep the screen on during voice conversations.

## Changes

- Added `wakeLockRef` (`WakeLockSentinel | null`) to hold the wake lock sentinel
- Added `releaseWakeLock()` — releases and nulls the sentinel (safe to call when null)
- Added `acquireWakeLock()` — requests `"screen"` wake lock, handles `NotSupportedError` silently
- `startConversation` → calls `acquireWakeLock()` after starting STT
- `stopConversation` → calls `releaseWakeLock()` after canceling STT/TTS
- `pauseConversation` → calls `releaseWakeLock()` after pausing
- `interruptConversation` → calls `releaseWakeLock()` after interrupting
- Unmount cleanup → calls `releaseWakeLock()` in addition to existing STT/TTS cleanup

## Why

Prevents device screen from dimming/off during active voice conversations, per issue #25.

## Verification

- Typecheck: PASS
- Lint: PASS (0 errors, pre-existing warnings only)
- Tests: 1056 passed (98 test files)
- Format: no issues in changed file; pre-existing 39-file format issues are unrelated
