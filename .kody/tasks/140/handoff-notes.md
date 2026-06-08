# Issue #140 — Slash command bubble shows expanded prompt

## What

`KodyChat.tsx` submit handler was building `userMessage` from the expanded
command body and handing it to `sendText`. `sendText` uses that same string
for both the model wire AND the visible user bubble — so typing
`/chat-review` and pressing Enter showed the full "You are doing a code
review…" prompt as if the user had typed it.

## Fix

Two-part, scoped to the normal submit path (the `isKodyWaiting` branch
is a sibling occurrence; see followups):

1. **`sendText` gained a `displayContent` option** on its options bag.
   `messageContent` is what the model sees on the wire (already
   optionally augmented with preview context); `displayContent` is what
   the user bubble shows. Defaults to `messageContent` so every other
   call site — voice, resume, hidden preview-act follow-ups — is
   unchanged.

2. **Submit handler passes `displayContent: rawInput`** when
   `expandSlashCommand` returns a hit. The model still receives
   `result.text` + context chips (the existing `userMessage` value);
   the bubble shows only what the user typed.

No `Message` type change. No `expandSlashCommand` change. No new
dependencies. All five structural assertions in the new test file
pass; existing `kody-chat-bubble-tool-call-markup` /
`kody-chat-composer` / `slash-commands` specs still pass.

## Files

- `src/dashboard/lib/components/KodyChat.tsx` — `sendText` options type
  (line ~1685), `displayContent` derivation (line ~1742), submit
  handler call (line ~3589).
- `tests/unit/chat/kodychat-slash-command-bubble.spec.ts` — new
  structural test mirroring the `kody-chat-bubble-tool-call-markup`
  pattern; pins all four markers (option shape, default, branch,
  model-wire direction) so a future refactor can't silently regress.
