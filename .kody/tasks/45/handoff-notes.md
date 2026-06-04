## What I did

Corrected the `kody-cmd` line in `.kody/duties/docs-code.md` (line 85):

- **Before:** `<!-- kody-cmd: @kody chore --issue <tracking> -->`
- **After:** `<!-- kody-cmd: @kody run --issue <tracking> -->`

The `disabled: false` on line 5 was already set, so no change was needed there.

## Why

The `chore` executable does not exist in kody-engine — only `run --issue <N>` exists (per the engine README and confirmed in the issue comments). The phantom `chore` verb would cause the duty's inbox rec to fail when the operator approves.

## Pre-existing issue

The format check fails on `.kody/reports/ceo-performance-review.md` — unrelated to this change; pre-existing.

## Followup

Coverage numbers in issue #45 may be stale (per operator comment). The three tracking issues (#16, #17, #18) may need refreshing before the duty's first tick runs.
