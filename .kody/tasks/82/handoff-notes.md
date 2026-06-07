# Issue #82 — PreviewModal action buttons hidden on mobile view

## What I found

The bug as described in the issue (className="hidden sm:flex" on the action bar)
is already fixed in the current `main` and the working branch
`82-previewmodal-action-buttons-hidden-on-mobile-view`. The current className is
`"flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-t border-zinc-800
bg-zinc-950/80 backdrop-blur-sm max-h-[40vh] overflow-y-auto"` — `flex` on the
base, no `hidden`, no `sm:flex`. Git history confirms this has been the case
since the file was first created; the only `hidden sm:flex` anywhere in the
dashboard code today is in `TaskList.tsx`, unrelated to PreviewActions.

The issue is still open, so the reporter likely filed it against an older
snapshot (or the description of the cause was inaccurate). The expected
behaviour — action buttons visible on mobile — is already met.

## What I changed

Added one regression test: `tests/unit/preview-actions-mobile.spec.ts`. It
asserts:

1. The action bar's base className contains `flex`.
2. The base className does NOT contain `hidden` (the root cause of the
   described bug — `twMerge` would let `hidden sm:flex` win if it appeared
   on the base).
3. The base className does NOT contain `sm:flex` on its own.
4. Neither `PreviewModal` nor `VibePage` passes a `className` override to
   `<PreviewActions>` that could reintroduce the bug at the call site.

I confirmed the test fails for the right reason by temporarily editing the
className to `"hidden sm:flex items-center …"` — two assertions failed with
the expected messages, then I restored the file. After restore, the test
passes and the full suite is green (`pnpm test`: 1200 passed, 10 skipped).

## What's next

No code fix needed. The PR should add the regression test and close the issue
with a note that the bug appears already fixed; the test prevents regression.
