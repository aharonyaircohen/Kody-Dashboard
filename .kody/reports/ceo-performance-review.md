# Kody Performance Review

_Cadence: weekly — delivery of owned responsibilities, not subjective quality._

CEO and Kody delivered this week (Kody surfaced from idle via clear-empty-goals). CTO, QA, and tech-writer all regressed — their active duties are silent in the repo this week, and the operator's own `context/todo.md` now lists two of them as structurally broken.

| Staff        | Owned duties   | Delivery | Consistency | Signal | Grade |
| ------------ | -------------- | -------- | ----------- | ------ | ----- |
| ceo          | 2 (1 active)   | High     | High        | High   | strong |
| coo          | 3 (0 active)   | —        | —           | —      | idle  |
| cto          | 4 (1 active)   | Low      | Low         | Low    | weak  |
| kody         | 12 (1 active)  | High     | High        | Med    | steady |
| qa           | 3 (1 active)   | Low      | Low         | Low    | weak  |
| tech-writer  | 2 (2 active)   | Low      | Low         | Low    | weak  |
| ux-designer  | 1 (0 active)   | —        | —           | —      | idle  |

- **coo — idle:** all three owned duties (duty-review, system-audit, task-memory-extractor) are `disabled: true`. No active responsibilities to deliver on. **Effect:** none — this is the operator's parking, not a miss. Listed for completeness.
- **cto — weak:** dev-ci-health targets a `dev` branch that does not exist in this repo (only `main`); per `context/todo.md` it is structurally blocked and produced no output this week. The other three owned duties (approval-gate, architecture-audit, pr-health-triage) are `disabled: true`. **Effect:** the 15m CI-health heartbeat is silent; CI regressions on main go unreviewed.
- **qa — weak:** qa-verify has no state and verified zero PRs this week — no `kody:ui-verified` / `kody:ui-failed` labels, no merge recommendations. Per `context/todo.md` regressions can ship unseen. The other two owned duties (qa, qa-sweep) are `disabled: true`. **Effect:** the 30m verification heartbeat is silent.
- **tech-writer — weak:** docs-code and docs-readme are both `disabled: false` in frontmatter, but neither produced a commit, report, or PR this week. Issue #45 (Enable docs-code duty) is still open with `kody:done` set — the duty is flipped on paper but not delivering. The last README-touching commit is `docs(previews)` from 2026-05-30, outside this window. **Effect:** the daily doc-drift guard is silent; the on-paper enable is misleading.
- **ux-designer — idle:** the only owned duty (design-review) is `disabled: true`. **Effect:** none — operator parking. Listed for completeness.
- **kody — steady:** clear-empty-goals is the only active duty and is firing on cadence — multiple refresh commits per day against a 1d `every`, with a real report (1 goal scanned, 0 empty, no action). The other 11 owned duties are `disabled: true` (operator's parking). **Effect:** the active duty delivers; the parked ones are silent by operator choice.

Notes on the downgrades:

- **cto steady→weak.** Last week dev-ci-health was firing 26× in the 7-day window. This week it has zero attributed output and `context/todo.md` now names the root cause (the `dev` branch it polls does not exist in this repo — only `main`).
- **qa steady→weak.** Same pattern: last week qa-verify was firing 26×; this week it has zero verdicts and `context/todo.md` records it as "has no state, verifies zero PRs."
- **tech-writer strong→weak.** Last week docs-code wrote real fixes in `.kody/tasks/45/`. This week neither docs-code nor docs-readme produced any repo output, despite both showing `disabled: false`. The on-paper enable has decoupled from actual delivery.
- **kody idle→steady.** clear-empty-goals (added 2026-06-01) is now firing daily and writing a real scan report. This is the only Kody-owned active duty; the rest remain operator-parked.

- Changes since last week: cto steady→weak; qa steady→weak; tech-writer strong→weak; kody idle→steady. ceo strong unchanged; coo, ux-designer idle unchanged.
