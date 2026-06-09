# Kody Performance Review

_Cadence: weekly — delivery of owned responsibilities, not subjective quality._

Same posture as the last three weeks: four of seven staff own active duties (5 active total), only tech-writer has an open finding, and the cto/qa structural gaps (missing labels, silent PR-stamping) are unchanged.

| Staff        | Owned duties  | Delivery | Consistency | Signal  | Grade   |
| ------------ | ------------- | -------- | ----------- | ------- | ------- |
| ceo          | 2 (1 active)  | High     | High        | High    | strong  |
| coo          | 3 (0 active)  | —        | —           | —       | idle    |
| cto          | 4 (1 active)  | Unclear  | Unclear     | Unclear | unclear |
| kody         | 11 (0 active) | —        | —           | —       | idle    |
| qa           | 3 (1 active)  | Low      | Low         | Low     | weak    |
| tech-writer  | 2 (2 active)  | Med      | Med         | Med     | steady  |
| ux-designer  | 1 (0 active)  | —        | —           | —       | idle    |

- **cto — unclear (fourth consecutive week, unchanged):** dev-ci-health is the only active duty (15m cadence). The `kody:dev-ci-red` label still does not exist in the repo label set (`gh label list | grep kody:dev-ci-red` returns nothing); zero issues carry that label. No `dev-ci-health.state.json` has been committed since the initial rev 1 from 2026-06-06 — the duty's `lastRunISO` is still unpersisted. **Effect:** no signal mechanism distinguishes "dev CI is green and the duty is silently idle by design" from "the duty is being dropped on every wake." Four weeks of identical signal is now structural, not transient.

- **qa — weak (fourth consecutive week, unchanged):** qa-verify's `kody:ui-verified` / `kody:ui-failed` labels exist in the repo, but **zero PRs** in the open + recently-merged set (#109, #119, #125, #126, #127, #135, #136, #137, #138, #139, #142, #144, #145, #147, #149, #152, #154, #155, #156, #158) carry either label. The `kody:cto-decisions` trust ledger that qa-verify's auto-merge shortcut reads is **still missing** from the repo label set. No `qa-verify.state.json` has ever been committed. **Effect:** the verdict→merge pipeline is open-loop end-to-end for the fourth week running; every recent delivery PR bypasses QA; the auto-merge branch is structurally dead until that label is created.

- **tech-writer — steady (fourth consecutive week, unchanged):** docs-code's most recent finding, issue #153 (`Doc-coverage gap: src/dashboard/lib/runners/`, opened 2026-06-08 10:12 UTC, PR #154 opened 2026-06-08 10:21 UTC, run `shipped/succeeded`) is still OPEN ~18h later — now carrying a `kody:done` label (process re-label, not a merge; the PR is not linked from the issue's close). No new `kody:docs-coverage` issues have been opened since #153, and `gh issue list --label kody:docs-coverage --state open` returns [#153] (one open, the same as last week). docs-readme still produces zero new `kody:docs` drift issues (the open list is []). No `docs-code.state.json` or `docs-readme.state.json` has ever been committed. **Effect:** the readme half is structurally unobservable (no cursor is persisted), and docs-code's single open finding has now been waiting ~4 days.

- **clear-empty-goals (unowned, unchanged):** active every 1d, but the duty frontmatter still has **no `staff:` field**. The last report write was 2026-06-07 09:53 UTC — now ~43h ago, ~19h overdue vs the 1d cadence. The latest report (`.kody/reports/clear-empty-goals.md`) last scanned 1 active goal (`kody-state-split`, 5 open tasks #50–#54), closed 0; the untracked `.kody/goals/ai-company-orchestration-7-gap-plan/state.json` (active since 2026-06-07 19:02 UTC, with task #91 `#92 [Orchestration] Duty contracts` and #95 closed on 2026-06-08) is still not incorporated. **Effect:** the process gap from the prior three weeks is still open; likely owner is coo given their planning/audit posture, but assigning it is the operator's call.

**Changes since last week:** none — ceo, coo, cto, kody, qa, tech-writer, ux-designer all held their prior grade.

**Structural note (cross-cutting, unchanged from the last three weeks):** of the 5 active duties, 2 depend on labels that still do not exist in the repo (`kody:dev-ci-red` for cto/dev-ci-health, `kody:cto-decisions` for qa/qa-verify's auto-merge branch). When a duty's own `gh label create` step does not run — or runs in a path that silently swallows its own error — the duty becomes structurally unable to deliver without surfacing a visible failure. The coo-owned duty-review and system-audit would catch this pattern at the design level if/when they are enabled.

**State-observability note (cross-cutting, unchanged from the last three weeks):** of the 5 active duties, **none** of cto/dev-ci-health, qa/qa-verify, tech-writer/docs-code, or tech-writer/docs-readme has a `.kody/duties/<slug>.state.json` ever committed to the repo. The only state file in git history is dev-ci-health rev 1 (initial, idle, empty) from 2026-06-06. The ceo-performance-review itself is also still missing state between ticks. **Effect:** every active staff's "is this duty actually running?" question is answered by inference (label drift, PR stamps, opened issues) rather than by direct evidence.

**Self-finding (ceo-performance-review, unchanged):** the prior state shape (`{ cursor: "seed", data: {} }`) — now confirmed unchanged at start of this tick — means the closing block is not being persisted between ticks. The report file has been committed **4 times in the past ~9h** (49e2b42a at 00:08 UTC, 6f7016ba at 23:05 UTC, 7a7874cb at 21:32 UTC, 8e7fbba5 at 19:50 UTC), well above the `every: 7d` cadence — the engine re-fires on every wake because `lastRunISO` is never written. **Effect:** "next run" readout cannot show a real cadence; cycle counter never advances; deltas in this report are hand-computed from the prior report body, not from `data.lastGrades`.
