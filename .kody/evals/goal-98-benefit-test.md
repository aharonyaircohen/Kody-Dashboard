# Goal #98 Benefit Test

Question: did the first two fixes make Kody clearer without adding busywork?

## Scope

Test only the first two fixes before continuing the rest of the goal:

- `#90` done/claim markers
- `#91` shared report schema

Do not judge `#92`-`#96` yet. Those are parked unless the first two prove value.

## Before Window

Use the 1-2 weeks before the fixes ship.

Default command:

```bash
node scripts/goal98-benefit-eval.mjs --since 2026-05-25 --until 2026-06-08 --comments
```

Tester repo command:

```bash
node scripts/goal98-benefit-eval.mjs --repo aharonyaircohen/Kody-Engine-Tester --since 2026-05-25 --until 2026-06-08 --comments
```

## After Window

Run the same command 7-14 days after `#90` and `#91` are merged, changing only the dates.

Example:

```bash
node scripts/goal98-benefit-eval.mjs --since 2026-06-09 --until 2026-06-23 --comments
```

## Metrics

1. Repeated work: duplicate-looking issue clusters should drop.
2. Claim visibility: closed issues should have a `<!-- claim: ... -->` or `<!-- done: ... -->` marker.
3. Report reuse: reports should pass the shared schema.
4. Human clarity: sample 5 issues and time how long it takes to answer "what happened here?"
5. Overhead: marker/report work should feel small, not like paperwork.

## Pass Rule

Continue the rest of goal #98 only if all of these are true:

- Claim/done marker coverage reaches at least 80% of closed Kody-owned issues.
- Report schema coverage reaches 100% for active reports.
- Duplicate-looking work drops by at least 50%, or there are no repeated high-confidence clusters.
- Human clarity time drops by at least 30% across 5 sampled issues.
- The process adds less than 2 minutes per closed issue or report.

## Stop Rule

Stop or redesign if either fix creates paperwork without reducing confusion.

## Current Baseline Notes

As of 2026-06-08:

- Dashboard: 78 issues in the window, 60 closed, 0 closed issues with claim/done markers, 5 duplicate-looking clusters, 0/2 reports passing the proposed schema.
- Tester: 86 issues in the window, 53 closed, 0 closed issues with claim/done markers, 3 duplicate-looking clusters, 0/3 remote reports passing the proposed schema.
- Dashboard repeated-looking clusters include docs coverage, chat merge-tool, and voice-screen work.
- Tester repeated-looking clusters include `add greet utility`, `feature flow: add greet utility`, and `Kody system audit`.
- The final benefit verdict is missing time: `#90` and `#91` have not shipped yet, and the after window has not happened.

## Immediate Implementation Check

After implementing the local Dashboard changes on 2026-06-08:

- Dashboard: 1 closed issue has a verified `done` marker, report schema exists, and 2/2 local reports validate.
- Tester: 1 closed issue has a verified `done` marker, but 0/3 remote reports validate because Tester reports have not been migrated to the new frontmatter shape.
- Tester migration branch: 3/3 reports validate after adding the schema frontmatter and `_schema.yaml`; Tester default branch stays red until that PR merges.
- This proves the marker detector and schema detector both work live; it does not prove long-term benefit yet.

## Final Summary Template

```text
Decision: keep going / change direction / stop here

Before:
- repeated work:
- marker coverage:
- report schema coverage:
- average clarity time:

After:
- repeated work:
- marker coverage:
- report schema coverage:
- average clarity time:

Verdict:
- benefit:
- cost:
- next move:
```
