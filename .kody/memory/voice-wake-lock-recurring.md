---
name: "Voice wake-lock is a recurring issue"
description: "User has flagged \"voice screen dims on mobile\" multiple times; prior fixes haven't stuck — verify any new fix actually holds on Android Chrome before closing."
type: project
created: 2026-06-08T08:55:01.222Z
---

User reported the voice-mode screen-stays-on issue several times across prior tasks/fixes; the screen still dims on Android Chrome as of issue #148.

Why: prior wake lock attempts in `src/components/chat/voice/useVoiceChat.ts` (lines 73-95) silently failed — the `wakeLockSentinel` is released on `visibilitychange` and the re-acquire call races against Chrome's "recent user gesture" check on Android, so re-acquisition throws NotAllowedError and the screen dims.

How to apply: when closing any future voice/wake-lock bug, require the implementer to (a) call `acquireWakeLock()` from `resumeConversation` as well, (b) defer the post-`visibilitychange` re-acquire via `setTimeout(100ms)` so the wake-up tap counts as a gesture, and (c) verify on a real Android Chrome device, not just emulator, before marking the bug done.
