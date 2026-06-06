# Kody Performance Review

_Cadence: weekly — delivery of owned responsibilities, not subjective quality._

CEO and tech-writer delivered this week; CTO and QA stopped reporting as broken and resumed firing, though neither shows clearly attributed output yet. COO, Kody, and ux-designer are idle by the operator's choice (all their duties are disabled).

| Staff        | Owned duties     | Delivery | Consistency | Signal | Grade |
| ------------ | ---------------- | -------- | ----------- | ------ | ----- |
| ceo          | 2 (1 active)    | High     | High        | High   | strong |
| coo          | 3 (0 active)    | —        | —           | —      | idle  |
| cto          | 4 (1 active)    | Med      | High        | Low    | steady |
| kody         | 11 (0 active)   | —        | —           | —      | idle  |
| qa           | 3 (1 active)    | Med      | High        | Low    | steady |
| tech-writer  | 2 (2 active)    | High     | High        | High   | strong |
| ux-designer  | 1 (0 active)    | —        | —           | —      | idle  |

- **coo — idle:** all three owned duties (duty-review, system-audit, task-memory-extractor) are `disabled: true`. No active responsibilities to deliver on. **Effect:** none — this is the operator's parking, not a miss. Listed for completeness.
- **kody — idle:** all eleven owned duties are `disabled: true` (cleanup-branches, inbox-ping, publish-release plus eight older ones). **Effect:** no recurring maintenance is firing; the only Kody-adjacent activity this week was manual `chore(kody)` operator commits.
- **ux-designer — idle:** the only owned duty (design-review) is `disabled: true`. **Effect:** no design reviews or visual-coherence sweeps ran.

Notes on the upgraded grades:

- **cto — steady (was weak).** dev-ci-health fired 26 times this week, recovering from the June 5 folder-duty migration break. No `fix(ci)` or `fix(dev-ci-health)` commit is attributed to it in the last 7 days, so the **Signal** axis stays Low; the duty is back on cadence but its deliverables are not visible in git. **Effect:** CI health is being polled again, but the operator still cannot tell from git alone what it found.
- **qa — steady (was weak).** qa-verify fired 26 times this week, also recovered. No `fix(qa)` or `fix(qa-verify)` commit is attributed to it. **Effect:** verification heartbeat is back, but the duty's verdicts are not surfacing as repo commits.
- **tech-writer — strong (was weak).** docs-code produced two real fixes in `.kody/tasks/45/` (correcting a phantom `@kody chore` verb to a valid `@kody run --issue`), and docs-readme is firing on cadence. Both duties are active and delivering.

- Changes since last week: cto weak→steady; qa weak→steady; tech-writer weak→strong. ceo strong unchanged; coo, kody, ux-designer idle unchanged.
