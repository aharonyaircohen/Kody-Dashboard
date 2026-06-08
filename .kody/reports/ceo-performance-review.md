# Kody Performance Review

_Cadence: weekly — delivery of owned responsibilities, not subjective quality._

Same shape as last week: ceo and tech-writer are the only two staff delivering observable output; cto and qa remain open-loop (zero stamped verdicts on their active duties); coo, kody, and ux-designer own no active duties. The unowned-but-active `clear-empty-goals` from last week is still unowned.

| Staff        | Owned duties  | Delivery | Consistency | Signal  | Grade   |
| ------------ | ------------- | -------- | ----------- | ------- | ------- |
| ceo          | 2 (1 active)  | High     | High        | High    | strong  |
| coo          | 3 (0 active)  | —        | —           | —       | idle    |
| cto          | 4 (1 active)  | Unclear  | Unclear     | Unclear | unclear |
| kody         | 11 (0 active) | —        | —           | —       | idle    |
| qa           | 3 (1 active)  | Low      | Unclear     | Low     | unclear |
| tech-writer  | 2 (2 active)  | High     | High        | High    | strong  |
| ux-designer  | 1 (0 active)  | —        | —           | —       | idle    |

- **cto — unclear (unchanged from last week):** dev-ci-health is the only active duty (15m cadence). No `.kody/duties/dev-ci-health.state.json` is committed; the `kody:dev-ci-red` label still does not exist in the repo's label set; and `actions/runs?branch=dev` returns no recent runs. Consistent with "polling and finding green per design" — but indistinguishable from "scheduler silently dropping it." **Effect:** still no observable signal whether the duty is alive; the only way to find out is to wait for a `dev` red and see if an issue is filed.
- **qa — unclear (downgrade from steady):** qa-verify is supposed to dispatch `ui-review` on each open delivery PR and stamp `kody:ui-verified` / `kody:ui-failed`. Both labels now exist in the label set (correction to last week's note that they didn't), but **no PR or issue carries either label** — checked #114, #115, #116, #117, #118, #119 plus a broader search. Every recent open delivery PR is missing a ui-review verdict. Last week's report attributed this to a kody:failed issue (#116) as evidence the duty was alive; on re-read, #116 is kody's own fix PR for issue #110 (the kody:failed label is the broader kody flow, not qa-verify's verdict), so the prior "producing real findings" line was a misread. **Effect:** the verdict→merge pipeline is still open-loop end-to-end, and worse than last week's framing suggested — every open PR is bypassing QA.
- **clear-empty-goals (unowned, unchanged):** active, refreshing its report daily (most recent 2026-06-07 09:54 UTC), but the duty frontmatter has no `staff:` field. Last week's process gap remains open; likely owner is coo given their planning/audit posture.

**Changes since last week:** qa steady→unclear (downgrade: zero stamped verdicts on recent PRs; prior "producing findings" was a misread of #116 as qa-verify output when it's actually kody's bug-fix PR); cto's label gap is partially closed (`kody:ui-verified` / `kody:ui-failed` now exist) but qa-verify isn't using them; ceo, coo, kody, tech-writer, ux-designer unchanged.