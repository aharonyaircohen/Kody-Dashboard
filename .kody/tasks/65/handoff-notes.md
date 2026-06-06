# Issue #65 — Composer two-row layout

## What I did

Restructured the chat composer in `src/dashboard/lib/components/KodyChat.tsx`
from a single rounded flex row into two distinct rows separated by a 1px
hairline, per the issue spec.

## Why

User wanted the textarea wider and the icon buttons (Paperclip, mic) demoted
to a dedicated action row below, with a hairline divider. The new action row
is also the future home for composer widgets (slash-command trigger, attachment
previews inline, mode toggles, repo/branch switcher, etc.) — the trailing
`flex-1` slot is reserved empty until those land.

## Layout after the change

- **Input row** — `[ Textarea (flex-1 relative) ][ Send/Stop/Start ]` —
  stretched to full width, no Paperclip/Mic siblings.
- **Separator** — `<div className="border-t border-border/40" />` (1px hairline
  matching the existing low-contrast separator token used elsewhere in the
  file).
- **Action row** — `[ file input (hidden) ][ Paperclip ][ VoiceButton ][
spacer (flex-1) ]` — left-anchored with breathing room on the right.

## Verification

- Repro test: `tests/unit/chat/kody-chat-composer.spec.ts` (5 cases). The
  4 layout cases are red on the pre-fix code and green after; the 5th
  (autosize-preservation guard) is invariant and stays green either way.
- `mcp__kody-verify__verify` reports `ok: true` with empty failures.
- No regressions: the outer composer container, context-chip row, access bar,
  and message list are byte-identical to `main`.

## Scope

Pure JSX layout refactor. No props, state, effects, or behavior changes.
Hidden file input moved to the action row alongside the Paperclip (still
hidden, still driven by the same `fileInputRef`).
