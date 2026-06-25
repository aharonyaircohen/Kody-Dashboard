---
staff: kody
disabled: true
---

# Dead Code Sweep

## Job

Monthly cleanup of unused exports, files, and dependencies. Runs `knip` / `ts-prune` / `depcheck` (via `/kody chore`) and opens **separate PRs per category** so review stays bounded.

**Cadence guard.** Run only on the **1st day of the month UTC**, and only if `data.lastRunISO` is older than 25 days. Otherwise emit unchanged state and exit.

**Per tick (one action max):**

1. Check for an in-flight sweep: `gh issue list --label "kody:dead-code-sweep" --state open --json number,title,createdAt,body`.
2. **If an open issue exists less than 14 days old:** emit `cursor: awaiting-prs` and exit (last month's sweep is still being processed — give reviewers time).
3. **If an open issue exists older than 14 days with fewer than 3 linked PRs merged or closed:** post a nudge once, then exit:
   ```
   gh issue comment <n> --body "Last month's sweep appears partially stalled. /kody chore: report status — which categories produced PRs, which still need work, which were dropped."
   ```
4. **Otherwise, open the monthly issue:**
   ```
   gh issue create \
     --title "dead-code: monthly sweep $(date -u +%Y-%m)" \
     --label "kody:dead-code-sweep" \
     --body "/kody chore: run a dead-code sweep using \`knip\`, \`ts-prune\`, and \`depcheck\`. Open up to FIVE separate PRs, one per category and bounded by size:\n\n1. **unused exports** — \`ts-prune\` findings, max 30 deletions per PR\n2. **unused files** — \`knip\` findings, max 15 file deletions per PR\n3. **unused devDependencies** — \`depcheck\` findings\n4. **unused dependencies (prod)** — \`depcheck\` findings, only if confidence is high\n5. **unused exports from \`src/lib/**\`** — these are the highest-signal cleanups\n\nDo NOT delete:\n- Anything under \`src/payload/collections/**\` (Payload collections are dynamically registered)\n- Anything imported via \`payload-config.ts\`\n- Anything in \`scripts/**\` flagged solely by \`knip\` (often invoked via package.json scripts knip can't see)\n- Files under \`messages/**\` (i18n)\n- Anything matching \`**/*.spec.ts\` or \`**/*.test.ts\`\n\nSkip categories where the tool reports zero findings — comment 'category: no findings' on this issue.\n\nClose this issue when all opened PRs are merged or rejected with rationale."
   ```
5. Stash `data.openIssue = <number>` and `data.openedISO = <now>`.

## Allowed Commands

- `gh issue list`, `gh issue create`, `gh issue comment`
- `gh pr list --search "label:kody:dead-code-sweep"` (to count linked PRs in step 3)

## Restrictions

- Never edit files. Never run `knip`/`ts-prune`/`depcheck`. Delegation only.
- Maximum one issue created or commented per tick.
- If `gh issue create --label kody:dead-code-sweep` fails because the label doesn't exist, run `gh label create kody:dead-code-sweep --description "Kody job: dead code sweep"` and retry the create. **Do not skip the label** — the next-tick "is sweep in flight?" check depends on it.
- Honor the do-not-delete list — never override it from this job's body. If the body needs updating (new safe-zone discovered after a bad PR), the human edits this file and the next tick re-reads it.
- This is the noisiest job — biases toward NOT firing if anything looks in-flight.

## State

- `cursor`: `idle` | `awaiting-prs` | `stalled`
- `data.lastRunISO`: ISO timestamp of last tick that opened or nudged an issue
- `data.openIssue`: number of currently-open monthly issue (or null)
- `data.openedISO`: ISO timestamp the current issue was opened (for stall detection)
- `data.nextEligibleISO`: UTC ISO timestamp this job will next be eligible to act, computed from the cadence guard above. **Always emit this, every tick.** For this job: the **next 1st-of-month 00:00 UTC** at or after `data.lastRunISO + 25d`. Surfaced as "next run" on the dashboard.
- `done`: always `false`
