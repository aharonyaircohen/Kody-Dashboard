# Kody Performance Review

_Cadence: weekly — delivery of owned responsibilities, not subjective quality._

Three of seven staff own active duties this week; only tech-writer produced fresh findings, and the cto/qa open loops from last week are unchanged.

| Staff        | Owned duties  | Delivery | Consistency | Signal  | Grade   |
| ------------ | ------------- | -------- | ----------- | ------- | ------- |
| ceo          | 2 (1 active)  | High     | High        | High    | strong  |
| coo          | 3 (0 active)  | —        | —           | —       | idle    |
| cto          | 4 (1 active)  | Unclear  | Unclear     | Unclear | unclear |
| kody         | 11 (0 active) | —        | —           | —       | idle    |
| qa           | 3 (1 active)  | Low      | Low         | Low     | weak    |
| tech-writer  | 2 (2 active)  | Med      | Med         | Med     | steady  |
| ux-designer  | 1 (0 active)  | —        | —           | —       | idle    |

- **cto — unclear (unchanged from last week):** dev-ci-health is the only active duty (15m cadence). The `kody:dev-ci-red` label still does not exist in the repo label set (15 kody:* labels confirmed, no `kody:dev-ci-red`); zero issues carry that label. Same ambiguity as last week: the duty is either polling and finding dev-branch CI green per design (not persisting) or being silently dropped. **Effect:** no signal mechanism distinguishes "healthy and silent" from "scheduled but never runs" — a `lastRunISO` stamp on idle-green would close the loop.

- **qa — weak (unchanged from last week):** qa-verify is supposed to stamp `kody:ui-verified` or `kody:ui-failed` on each delivery PR after running `ui-review` against the preview. Both labels exist in the repo, but a fresh `gh pr list --label kody:ui-verified/kody:ui-failed --state all` returns zero PRs across this weeks merge batch (~25 merges on 2026-06-08 alone: #107, #114, #115, #116, #121, #126, #127, #135–#139, #142, #145, #147, #149, #152, #155, #156, plus the 2026-06-07 batch). **Effect:** the verdict→merge pipeline is still open-loop end-to-end — every recent delivery PR bypasses QA. The `kody:cto-decisions` trust ledger that qa-verify's auto-merge shortcut reads is also still missing from the repo label set, so the auto-merge branch is structurally broken until that label is created.

- **tech-writer — steady (unchanged from last week):** docs-code produced 3 fresh findings this week — issue #100 (`docs-code duty: dispatch verb chore --issue not in engine README`, opened 2026-06-07 19:21, closed 2026-06-07 20:01, ~40 min loop), issue #125 (`Doc-coverage gap: src/dashboard/lib/ui-verify/`, 2026-06-08 05:10 → 05:24), and issue #153 (`Doc-coverage gap: src/dashboard/lib/runners/`, 2026-06-08 10:12, still OPEN). Tight close loops on the closed ones, with a real current finding in flight. docs-readme produced zero `kody:docs-drift` issues this week — could be legitimate idle (no merged PRs touched a documented area without updating the doc) or stuck (the duty requires a `data.lastCheckedMergedAt` cursor and no state file is persisted remotely, so we cannot tell). **Effect:** the readme half is structurally unobservable the same way dev-ci-health is — a cursor dump on idle-green would close it.

- **clear-empty-goals (unowned, unchanged):** active; duty frontmatter still has no `staff:` field. The most recent refresh is `.kody/reports/clear-empty-goals.md` from 2026-06-07 09:53 UTC (the 2026-06-08 14:34 commit on the same path is PR #156 — Goal 98 schema frontmatter landing, not a new finding). The 2026-06-07 run scanned 1 active goal (`kody-state-split`, 5 open tasks #50–#54) and closed nothing. Process gap from last week still open — likely owner is coo given their planning/audit posture.

**Changes since last week:** none — ceo, coo, cto, kody, qa, tech-writer, ux-designer all held their prior grade.

**Structural note (cross-cutting, unchanged):** of the 3 active duties this week, 2 depend on labels that still do not exist in the repo (`kody:dev-ci-red` for dev-ci-health, `kody:cto-decisions` for qa-verify's auto-merge branch). When a duty's own `gh label create` step does not run — or runs in a path that silently swallows its own error — the duty becomes structurally unable to deliver without surfacing a visible failure. Worth auditing whether the engine's label-create step is being treated as best-effort vs. fail-loud.

