# Issue #150 — Preview pane missing on mobile for completed tasks

## What I did

The mobile Preview button in `TaskDetail.tsx` (and the desktop quickLinks
Preview chip that uses the same JSX) was gated on
`task.column === "review" || task.column === "done"`. A "completed" task in
any other column — e.g. a `building` task whose pipeline run finished, or
a `failed` / `retrying` / `gate-waiting` task whose PR is still around —
has a `task.associatedPR` and therefore an openable preview, but the
button was hidden. On mobile (< md) the right-side preview pane is also
hidden, leaving the user with no way to reach the preview at all.

The fix drops the column gate entirely. The button is now shown
whenever the task has a PR and the host has supplied an `onOpenPreview`
handler — having a PR is the necessary and sufficient signal that a
preview is potentially available, regardless of which column the task
currently lives in.

## Files changed

- `src/dashboard/lib/components/TaskDetail.tsx` — dropped the
  `(task.column === "review" || task.column === "done")` clause from
  both the desktop quickLinks chip (line ~1180) and the mobile bottom
  toolbar pill (line ~1886). Kept the existing
  `task.associatedPR && onOpenPreview` gate so callers that don't
  supply a handler (or tasks without a PR) still don't render the
  button.
- `tests/unit/task-detail-mobile-preview.spec.ts` — 3 source-level
  structural assertions: desktop chip must not require the column to
  be review/done, mobile button must not require the column to be
  review/done, and the necessary pre-conditions (`task.associatedPR`,
  `onOpenPreview`, `onOpenPreview()` call) must still be present.

## Verification

`mcp__kody-verify__verify` returned `{ ok: true }` on attempt 2
(initial attempt failed on a prettier format warning — fixed via
`pnpm format`). 1292 tests pass, 10 skipped, 0 failures.
