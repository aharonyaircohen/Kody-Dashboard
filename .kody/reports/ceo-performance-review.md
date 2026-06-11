# Kody Performance Review

_Cadence: weekly — delivery of owned responsibilities, not subjective quality._

Tech-writer is the only staff delivering visible work this week — docs-code opened issue #168 with a real rec today; cto and qa keep running on cadence but emit zero observable signal, and the unowned `clear-empty-goals` has been silent for four days.

| Staff        | Owned duties  | Delivery | Consistency | Signal | Grade   |
| ------------ | ------------- | -------- | ----------- | ------ | ------- |
| ceo          | 2 (1 active)  | High     | Med         | Med    | steady  |
| coo          | 3 (0 active)  | —        | —           | —      | idle    |
| cto          | 4 (1 active)  | Low      | Med         | Low    | unclear |
| kody         | 11 (0 active) | —        | —           | —      | idle    |
| qa           | 3 (1 active)  | Low      | Med         | Low    | weak    |
| tech-writer  | 2 (2 active)  | High     | High        | High   | strong  |
| ux-designer  | 1 (0 active)  | —        | —           | —      | idle    |
| *(unowned)*  | 2 (1 active)  | Low      | Low         | Low    | weak    |

- **cto — unclear (unchanged from prior report):** `dev-ci-health` keeps firing on its 15m cadence but no `.kody/reports/dev-ci-health.md` exists, no `kody:dev-ci-red` / `kody:dev-ci-green` issue has ever been opened, and there is no state file on disk to confirm whether the duty is reading dev's CI checks at all. The "if dev is green we cannot see it; if broken, the operator has not been notified" framing from the prior report still holds. **Effect:** the fix pipeline that bypasses the PR layer (dev has no PR) is unobservable — operator cannot tell which side of the unknown they are on. Disambiguation requires a one-time probe, not another week of waiting.
- **qa — weak (unchanged from prior report):** `qa-verify` runs every 30m but still produces zero `kody:ui-verified` / `kody:ui-failed` issues; 15+ open PRs in the queue would benefit from a verdict. `kody:cto-decisions` trust-ledger label does not exist. The unverified-PR carryover has not shrunk. **Effect:** the verdict→merge gate is open-loop; PRs continue to merge without ui-review. Same lever as last week: a single probe of why the dispatch is silent.
- ***(unowned)*** — weak (unchanged from prior report): `clear-empty-goals` last wrote `.kody/reports/clear-empty-goals.md` on 2026-06-07 — 4 days of silence past its 1d cadence. The newly added `repo-graph` is unowned and has no `every:` frontmatter, so the engine does not schedule it; the duty is parked, not failing. **Effect:** goals manifest can drift faster than the duty scans it, and the new repo-graph never refreshes. Levers: (a) add a `staff:` field to `clear-empty-goals` (and resolve whether it is also blocked on the engine-verb fix), (b) add frontmatter to `repo-graph` and assign an owner, (c) decide whether repo-graph is meant to run via `duty-tick` or stay manual.

**State machine (8th visible report, no state on disk):** input was again `{"version":1,"rev":0,"cursor":"seed","data":{}}`. The state-persistence fix is still not landing. From the engine's view this is cycle 1; 7 prior weekly reports in git history do not reach the state file. `data.lastGrades` is therefore empty for the 8th consecutive tick, so the formal closing delta is omitted until persistence lands. The prior visible report graded tech-writer `steady`; this week it is `strong` (docs-code produced a real finding with a tracking issue and a rec; both duties ran on cadence).
