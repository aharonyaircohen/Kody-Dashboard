# Issue #24 — MiniMax M3 vision support

The issue body flagged `docs/notifications.md` as a doc-drift candidate from
PR #20, but the `@kody run` comment on the issue redefined the work:
add a vision-model pattern so MiniMax M3 attachments are sent as real image
parts instead of being inlined as text. Followed the comment, not the body.

## What changed

### `src/dashboard/lib/chat/vision-support.ts`
- New entry in `VISION_MODEL_PATTERNS`: `/minimax-m3/` with a one-line
  comment that flags the M2 / M2.7 generations as intentionally text-only.
- File-header doc-comment: the "e.g. MiniMax" example now reads
  "e.g. MiniMax M2.7" so the cited text-only generation is still accurate
  after M3 is reclassified as vision.

### `tests/unit/chat/vision-support.spec.ts`
- Header comment rewritten so the load-bearing cases are "Gemini and
  MiniMax M3 (vision) / MiniMax M2.7 (text)".
- Three M3 cases added to `visionModels`: `minimax/MiniMax-M3`,
  `MiniMax-M3`, `minimax-m3` — covers the `provider/model` spec, the bare
  model name, and the fully-lowercase form.
- `textModels` keeps the existing M2 / M2.7 cases; the inline-fallback
  contract for the older generations is now load-bearing.
- Whitespace/case test gained an M3 assertion alongside the M2.7 one.

## Plan deviations

- The operator wrote "add a `/minimax/` pattern". Added `/minimax-m3/`
  instead. A bare `/minimax/` would also match `minimax-m2.7` and
  `minimax-m2`, which the same comment says must stay text-only ("keep
  the inline fallback for any non-vision model ids that don't match").
  M3-specific pattern satisfies both halves of the request.

## Verification

- `verify` (typecheck + lint + tests) — passed first try.
