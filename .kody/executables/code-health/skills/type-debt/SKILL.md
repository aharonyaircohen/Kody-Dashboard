---
name: type-debt
description: Track TypeScript escape hatches and escalate meaningful growth week over week.
---

# Type Debt Tracker Skill

Use this skill when the `type-debt` executable runs from the matching duty.

Runtime state is owned by the engine. Do not ask the duty author to configure raw state keys.

## Method

## Job

Weekly tracking of TypeScript escape hatches: occurrences of `any`, `@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck` across `src/**` and `tests/**`. Trends matter more than absolute counts — flag when growth exceeds 5% week-over-week.

**Per tick (one action max):**

1. Job cannot grep locally. Trigger a Kody executable to count and report by opening (or reusing) the weekly tracking issue:
   ```
   gh issue list --label "kody:type-debt" --state open --json number,title,createdAt,body
   ```
2. **If an open issue exists less than 7 days old:** emit `cursor: awaiting-result` and exit (last week's count is still being processed).
3. **If an open issue exists older than 7 days with no closing PR:** post one nudge:
   ```
   gh issue comment <n> --body "Type-debt count appears stalled. /kody chore: report current counts and close this issue."
   ```
   Then exit.
4. **Otherwise, open the weekly issue:**
   ```
   gh issue create \
     --title "type-debt: weekly count $(date -u +%Y-%m-%d)" \
     --label "kody:type-debt" \
     --body "/kody chore: count occurrences of \`any\`, \`@ts-ignore\`, \`@ts-expect-error\`, and \`@ts-nocheck\` across \`src/**\` and \`tests/**\` (exclude \`payload-types.ts\` and \`*.d.ts\` from generated bundles). Post counts as a single comment on this issue in the format: \`stmts: any=<N> ts-ignore=<N> ts-expect-error=<N> ts-nocheck=<N> | total=<N>\`. Then compare against the prior week (see body below) — if total grew by >5%, open a separate cleanup PR removing the lowest-effort 5 occurrences (prefer dead-code paths and test files). Close this issue when the count comment lands.\n\nPrior week: ${data.lastCount ? JSON.stringify(data.lastCount) : 'none on record'}\nGrowth threshold: 5%"
   ```
5. Stash `data.openIssue = <number>`.
6. **Closing the loop:** when a future tick finds the prior issue closed, parse the latest count comment from `gh issue view <n> --comments --json comments` and update `data.lastCount = { ...parsed, capturedISO: <issue.closedAt> }`. (Do this opportunistically, not as a separate action — it's metadata, not a `gh` action that counts toward the tick limit.)

## Allowed Commands

- `gh issue list`, `gh issue create`, `gh issue comment`, `gh issue view`

## Restrictions

- Never edit files. Never run `tsc` or `grep`. Counting is delegated to the `chore` executor.
- Maximum one issue created or commented per tick.
- If `gh issue create --label kody:type-debt` fails because the label doesn't exist, run `gh label create kody:type-debt --description "Kody job: type debt"` and retry the create. **Do not skip the label** — the next-tick stall-detection depends on it.
- Do NOT open the cleanup PR yourself — that's part of the `/kody chore` body. The job only orchestrates.
