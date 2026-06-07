# Kody Performance Review

_Cadence: weekly — delivery of owned responsibilities, not subjective quality._

Three of seven staff delivered this week (ceo, qa, tech-writer). Tech-writer produced a steady stream of real doc-coverage findings; cto's only active duty remains unverifiable (no state, no tracking label, no dev-branch workflow runs to confirm polling); coo, kody, and ux-designer own no active duties.

| Staff        | Owned duties  | Delivery | Consistency | Signal  | Grade   |
| ------------ | ------------- | -------- | ----------- | ------- | ------- |
| ceo          | 1 (1 active)  | High     | High        | High    | strong  |
| coo          | 3 (0 active)  | —        | —           | —       | idle    |
| cto          | 4 (1 active)  | Unclear  | Unclear     | Unclear | unclear |
| kody         | 11 (0 active) | —        | —           | —       | idle    |
| qa           | 3 (1 active)  | High     | Med         | Med     | steady  |
| tech-writer  | 2 (2 active)  | High     | High        | High    | strong  |
| ux-designer  | 1 (0 active)  | —        | —           | —       | idle    |

- **cto — unclear:** dev-ci-health is the only active duty (15m cadence). No `.kody/duties/dev-ci-health.state.json` exists, the `kody:dev-ci-red` label the duty claims to stamp is not in the repo's label set, and `actions/runs?branch=dev` returns no recent runs. Consistent with "polling and finding green per design" — but indistinguishable from "scheduler silently dropping it." **Effect:** we have no observable signal whether the duty is alive; the only way to find out is to wait for a `dev` red and see if an issue is filed.
- **qa — steady (with caveat):** qa-verify is producing real findings — `kody:failed` issues are landing (e.g. #116) — so the duty is alive and writing. But the labels it claims to stamp (`kody:qa-verify` and likely the verdict-pass/fail pair) do not exist in the repo, so the verdict-to-merge path can't act on what qa-verify writes. **Effect:** the verification step is open-loop — verdicts are produced, but the downstream merge reader doesn't see them.

Side note (unowned duty, unchanged from prior cycle): `clear-empty-goals` is active and refreshing its report daily, but its frontmatter has no `staff:` field. An active running duty with no owner remains a process gap and should be assigned (likely coo, given the planning/audit posture of their disabled duties).

**Changes since last week:** ceo, coo, cto, kody, qa, tech-writer, ux-designer unchanged.
