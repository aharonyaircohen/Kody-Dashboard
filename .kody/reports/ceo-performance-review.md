# Kody Performance Review

_Cadence: weekly — delivery of owned responsibilities, not subjective quality._

**Week 16.** Same picture as week 15: 5 active duties, all run on schedule (~4–5×/day each, all `outcomeKind: ok` per the kody-state activity log), and 3 of them — `dev-ci-health`, `qa-verify`, `docs-readme` — complete without producing their gate artifacts. The unowned `clear-empty-goals` is still absent from the activity log. The structural finding (activity log records `outcome` but not `why` a duty completed without producing one) is the load-bearing reason the same grades keep coming back.

| Staff        | Owned duties  | Delivery | Consistency | Signal | Grade   |
| ------------ | ------------- | -------- | ----------- | ------ | ------- |
| ceo          | 2 (1 active)  | High     | High        | High   | strong  |
| coo          | 3 (0 active)  | —        | —           | —      | idle    |
| cto          | 4 (1 active)  | Med      | High        | Low    | unclear |
| kody         | 11 (0 active) | —        | —           | —      | idle    |
| qa           | 3 (1 active)  | Med      | High        | Low    | weak    |
| tech-writer  | 2 (2 active)  | High     | High        | Med    | steady  |
| ux-designer  | 1 (0 active)  | —        | —           | —      | idle    |
| *(unowned)*  | 1 (1 active)  | Low      | Low         | Low    | weak    |

- **cto — unclear (16th week, unchanged):** `dev-ci-health` runs ~5×/day and completes `ok`; still no `kody:dev-ci-red` label or tracking issue, still no `.kody/reports/dev-ci-health.md` on disk, and the only structured state file on either branch is still `.kody/duties/dev-ci-health.state.json` (cursor `idle`, data `{}`). The activity log records `outcome` but not the reason a tick completed without acting — same "dev is green vs duty is silently broken" ambiguity as week 15. **Effect:** if `dev` is green, the duty is doing its job and we cannot see it; if it is broken, the operator has not been notified for 16 weeks.
- **qa — weak (16th week, unchanged):** `qa-verify` runs ~5×/day and completes `ok`; **0** open PRs carry `kody:ui-verified` or `kody:ui-failed` (verified — 0 hits on both label queries). The `kody:cto-decisions` trust-ledger label still does not exist. Three more docs-code PRs landed in the 3.5 h since the week-15 report (#155, #162, #164, all `kody:done`) — each one should have triggered a verdict comment, none did. **Effect:** verdict→merge pipeline remains open-loop; docs-code output is auto-bypassing QA.
- **clear-empty-goals (unowned, 16th week, unchanged):** still 0 entries in the activity log across 7 sampled days (2026-06-03 → 2026-06-10); the on-disk report at `.kody/reports/clear-empty-goals.md` is still the 2026-06-07 09:53:00Z finding (now 3+ days stale); the untracked `.kody/goals/{kody-state-split,ai-company-orchestration-7-gap-plan}/state.json` files are still staged/added in the worktree (same as week 14 + 15). **Effect:** the manifest is being mutated faster than it can be scanned; the unowned duty has now been effectively stopped for two consecutive weeks.

**Changes since last week:** tech-writer strong→steady. ceo strong→strong; coo idle→idle; cto unclear→unclear; kody idle→idle; qa weak→weak; ux-designer idle→idle; *(unowned)* weak→weak. The tech-writer downgrade is honest: the breakthrough was week 15's first burst; this week is the same pattern continuing. docs-code is *more* productive (9 PRs total, 3 new since week 15) but the docs-readme half is unchanged and the docs-code PRs still get no QA verdict — more output, same asymmetry. **strong → steady** reflects "sustained, not advancing."

**Kody-state branch (16th week, stable):** the activity log now spans 7 consecutive days with the same 5 duties running ~4–5×/day each, all `outcomeKind: ok`. The log is the authoritative execution surface; the structured state file discipline is not — only `dev-ci-health.state.json` exists on either branch. The 4 other active duties (ceo, docs-code, docs-readme, qa-verify) have **no** state file at all; the engine's `data.lastRunISO` for those is being computed from the log, not from the file.

**State-observability — the load-bearing structural finding (16th week, unchanged):** the activity log records `outcome` and `outcomeKind` but not *why* a duty completed without producing a visible artifact. Until the engine emits an `outcomeReason` (or `noopReason`) field, every silent-but-ok duty is ambiguous between "correctly idle" and "silently broken." This single gap is the reason the cto grade stays `unclear` and the qa grade stays `weak` for the 16th consecutive week. **Highest-ROI change available:** add `outcomeReason: "dev green" | "no PR ready" | "chore verb missing" | "n/a"` to the activity log entry. Two-line engine change; collapses three open questions to one.

**Cadence over-fire (16th week, same finding):** `ceo-performance-review` has been committed 5 times today (00:15, 04:56, 08:51, 12:14, and now); the activity log shows 4 runs of this duty so far on 2026-06-10. State is being introduced this tick (`cursor: seed` → `reported`, `data.cycle: 1`); until `data.lastRunISO` is on disk between ticks, the engine cannot enforce `every: 7d` for this duty. **Effect:** the cadence readout on the dashboard remains decorative until the next tick.

**First tick with structured state (this report):** the prior 15 reports on disk are untracked. This is cycle 1 of the structured state machine. `data.lastGrades` is being emitted for the first time, so next week's delta is computable from state rather than re-parsing the prior report body.

**Operator-driven work in the window:** no new operator commits to `main` since the week-15 report's cut-off. All activity in the window is duty-driven: 3 docs-code PRs (#155, #162, #164) and the kody-state activity-log writes.
