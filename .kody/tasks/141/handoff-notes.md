# Issue #141 — Preview Inspector chips leak their full context into the user bubble

Mirrored the #140 slash-command display/wire split for the picker-attached
chips. The user bubble now shows only the typed text; the model still
receives the typed text + the formatted chip context (picked elements,
console errors, failed requests, perf snapshots).

## What changed

- `src/dashboard/lib/components/kody-chat-helpers.tsx` — added
  `buildUserTurnParts({ baseMessage, chipContexts, previewContext })` as a
  pure helper. Returns `{ displayContent, wireContent }` where
  `displayContent` is the clean typed text and `wireContent` is the
  base message plus any non-blank chip contexts and the preview context
  (in that order, joined with blank lines).
- `src/dashboard/lib/components/KodyChat.tsx` —
  - `sendText` now takes an optional 4th param `chipContexts: string[]`
    and uses `buildUserTurnParts` to compute `displayContent` and
    `wireContent` (replacing the inline preview-context-only split).
  - `sendMessage` passes `baseMessage` (clean) and
    `currentChips.map((c) => c.context)` to `sendText`, so the bubble
    shows just the typed text while the four wire paths (kody backend,
    brain backend, kody-live, engine) all carry the full payload.
  - The `isKodyWaiting` action-instruction branch now shows `baseMessage`
    in the bubble but still ships `userMessage` (with chips) as the
    instruction payload.
- `tests/unit/chat/kody-chat-helpers.spec.ts` — added a `buildUserTurnParts`
  describe block covering: no-extras (identity), chips-only, preview-only,
  chips + preview, blank-chip filtering, blank-preview handling, and the
  no-extras no-op path.

## Why this shape

`displayContent` / `wireContent` is the existing in-`sendText` split
introduced for the auto-attached preview page context (commit dc12fa8f).
Reusing the same helper for picker chips keeps the four wire paths
(kody, brain, kody-live, engine) untouched — they already consume
`wireContent` — and avoids hand-rolling per-backend behavior.

## Verification

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm format:check` ✅ (one prettier warning on the new helper, fixed)
- `pnpm test` ✅ (new `buildUserTurnParts` cases pass; no regressions)
