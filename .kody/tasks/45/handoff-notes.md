## What I did

Enabled the docs-code duty in `.kody/duties/docs-code.md` with three targeted fixes:

1. **Line 85** — kody-cmd verb: `@kody chore --issue` → `@kody run --issue`
   (`chore` is phantom in kody-engine; only `run --issue` is valid)
2. **Lines 20-21** — stale gate-note: removed "`disabled: true` until..." paragraph and
   replaced with a one-liner confirming both gate conditions are met and `disabled: false`
   is set
3. **Lines 90-91** — self-referential verification note: `chore --issue` → `run --issue`

`disabled: false` on line 5 was already correct — no change needed there.

## Why

The phantom `chore` verb would cause the duty's inbox rec to silently fail at dispatch
time. The stale `disabled: true` note and the `chore --issue` reference in the
verification note were also misleading now that the duty is live.

## Pre-existing issue

Format check fails on `.kody/reports/ceo-performance-review.md` — unrelated to this
change; pre-existing condition.

## Followup

Coverage numbers in issue #45 may be stale (per operator comment 2026-06-04T23:23:34Z).
The three tracking issues (#16, #17, #18) may need refreshing before the duty's first
tick runs, or the duty may emit incorrect recommendations on its first sweep.
