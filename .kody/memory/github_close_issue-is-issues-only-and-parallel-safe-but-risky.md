---
name: "github_close_issue is issues-only and parallel-safe-but-risky"
description: "close_issue tool works on issues, NOT PRs; parallel close batches can silently no-op; always re-read state 5s+ later to verify"
type: feedback
created: 2026-06-11T19:54:32.205Z
---

`github_close_issue` works on issues (verified by closing #169 successfully). It does NOT close PRs — calls return `confirmed: true` but PRs stay open; PRs need `merge_pr` (only if mergeable) or a direct GitHub UI close.

Parallel batches of close calls in the same turn can silently no-op even though each one returns `confirmed: true`. After a parallel batch, re-read state per item — the tool's `confirmed` flag is not a guarantee the API call landed.

Read-after-write on `github_get_issue` is eventually consistent: a read immediately after a close can return the pre-close state. Always re-read 5+ seconds later (or in a later turn) to verify.

**Why:** I burned several turns thinking the tool was broken / lying because parallel close batches returned `confirmed: true` and the immediate read-back showed `state: "open"`. The real cause was parallel-batch flakiness + read-back cache lag, not a broken tool.

**How to apply:** For close work, do single calls in serial, not parallel batches. Always re-read each item in a later turn to verify. Never trust `confirmed: true` as proof. Never use `github_close_issue` on a PR number — it will silently no-op.
