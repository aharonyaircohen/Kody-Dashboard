# Issue #131 — Send button moved into the input row

The chat composer's trailing-edge send/stop button now lives inside the input row alongside the textarea, not in the action row below. The button is a single role that swaps by state (paper-plane Send icon when idle, lucide `Square` stop icon when in-flight) — replacing both the old red `bg-destructive` "Stop" text button that used to sit in the input row, and the inline Send icon that used to live in the action row.

## What changed

- `src/dashboard/lib/components/KodyChat.tsx` — replaced the input row's two red Stop text buttons (`loading` and `composerAction === "stop" | "cancel"`) and the action row's inline Send button with one trailing icon button in the input row. The action row now only contains Paperclip + VoiceButton + the reserved flex-1 spacer. Added `Square` to the lucide-react import.
- `tests/unit/chat/kody-chat-composer.spec.ts` — flipped the existing structural assertions (input row MUST contain `<Send`, action row MUST NOT) and added a new test pinning the no-red-`bg-destructive`-button invariant from the issue refinement.

## Why

The previous layout (issue #65's split) had the send affordance in the action row, separated from the textarea by a row gap. The issue body asked for it back in the input row, and the refinement collapsed the "red Stop text button + inline Send icon" pair into a single trailing icon button — one role, one slot, one mental model. The structural test was updated to mirror the new invariant so a future refactor cannot silently regress to either the post-#65 split or the original single-row layout.
