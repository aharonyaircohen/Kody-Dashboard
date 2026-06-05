# Kody Performance Review

_Cadence: weekly — delivery of owned responsibilities, not subjective quality._

One of six staff with active duties delivered this week; four active duties are not running after the June 5 folder-duty migration. CTO remains structurally blocked; QA and tech-writer produced no output.

| Staff        | Owned duties    | Delivery | Consistency | Signal | Grade |
| ------------ | --------------- | -------- | ----------- | ------ | ----- |
| ceo          | 1 (1 active)   | High     | High        | High   | strong |
| coo          | 3 (0 active)   | —        | —           | —      | idle  |
| cto          | 4 (1 active)    | None     | No runs since migration | None | weak |
| kody         | 11 (0 active)   | —        | —           | —      | idle  |
| qa           | 3 (1 active)    | None     | No runs since migration | None | weak |
| tech-writer  | 2 (2 active)    | None     | No runs since migration | None | weak |
| ux-designer  | 1 (0 active)    | —        | —           | —      | idle  |

- **cto — weak:** dev-ci-health (every 15m) structurally blocked — watches `dev` branch CI but no `dev` branch exists (only `main`). Additionally, the duty has produced no commits since the June 5 folder-duty migration; the scheduler is not dispatching it. **Effect:** dev CI health permanently invisible; structural issue unresolved. Unchanged since June 5.
- **qa — weak:** qa-verify (every 30m) has not run since the folder-duty migration. The duty is defined but the scheduler is not dispatching it — zero kody workflow runs in the past week show qa-verify execution. Open PRs (#55, #56, #58, #61, #62, #63) carry only `kody:done`; no `kody:ui-verified` or `kody:ui-failed` labels, and no `ui-review` workflow exists in `.github/workflows/`. **Effect:** all open delivery PRs lack UI verification; qa-verify is effectively offline. Changed from unclear to weak — now confirmed broken/not-running, not just uncertain.
- **tech-writer — weak:** docs-code and docs-readme (every 1d each) have produced no commits and written no reports since the June 5 folder-duty migration. The scheduler is not dispatching either duty. **Effect:** no docs coverage or drift tracking is running. Previously steady; degraded to weak this week.

- Changes since last week: qa unclear→weak (confirmed not running); tech-writer steady→weak (no output since migration); coo, kody, ux-designer idle unchanged; cto weak unchanged; ceo strong unchanged.