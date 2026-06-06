# Coverage Floor

## Job

Daily check that test coverage on `dev` (and `main`) hasn't fallen below the floor. Floor: **80% statements, 75% branches**. Triggers a Kody fix when the floor is breached.

**Cadence guard.** If `data.lastRunISO` is set and within the last 20 hours, emit unchanged state and exit. Otherwise proceed and update `data.lastRunISO` to now.

**Per tick (one action max):**

1. Find the most recent successful CI run on `dev`:
   `gh run list --branch dev --workflow ci --status success --limit 1 --json databaseId,headSha,createdAt`
2. Download its coverage artifact (artifact name: `coverage-summary`):
   `gh run download <runId> --name coverage-summary --dir /tmp/kody-cov-$RUN_ID`
   Then read `/tmp/kody-cov-<runId>/coverage-summary.json` (Read tool is allowed).
3. Parse `total.statements.pct` and `total.branches.pct`. Compare against floor (80% / 75%).
4. **Below floor:** if neither metric was already breached at last tick (`data.lastBreach == null`), open an issue:
   ```
   gh issue create \
     --title "coverage: below floor — stmts <X>% / branches <Y>%" \
     --label "kody:coverage-floor" \
     --body "Floor is 80%/75%. Current: stmts <X>%, branches <Y>%. Run <runId> on SHA <headSha>. /kody chore: identify the files with the largest uncovered-line counts (top 5) and open a PR adding focused tests. Close this issue when both metrics are back above floor."
   ```
   Stash `data.lastBreach = { stmts, branches, runId, openedISO, issue }`.
5. **Above floor and previously breached:** post a closing comment on the open issue and clear `data.lastBreach`:
   ```
   gh issue comment <n> --body "Floor restored — stmts <X>%, branches <Y>%. Auto-closing."
   gh issue close <n>
   ```
6. **Above floor and no prior breach:** narrate briefly, do nothing.
7. **Coverage TREND signal (informational):** if `data.lastCoverage` exists and current stmts dropped by ≥2pp without breaching the floor, post one comment on the most recent merged PR (`gh pr list --base dev --state merged --limit 1 --json number`) flagging the regression — do NOT open an issue, just a heads-up. Update `data.lastCoverage = { stmts, branches, runId, capturedISO }` regardless.

## Allowed Commands

- `gh run list`, `gh run view`, `gh run download`
- `gh issue list`, `gh issue create`, `gh issue comment`, `gh issue close`
- `gh pr list`, `gh pr comment`
- Read tool on `/tmp/kody-cov-*/coverage-summary.json` only.

## Restrictions

- Never edit, create, or delete files in the working tree. (Downloads under `/tmp` are NOT in the working tree.)
- Never push, never commit.
- Maximum one issue/comment per tick.
- If the artifact `coverage-summary` is missing on the latest CI run, do not error loudly — narrate and exit. (CI may not yet emit it; that's a one-time setup gap.)

## State

- `cursor`: `idle` | `tracking` | `breached`
- `data.lastRunISO`: ISO timestamp of last tick that took action
- `data.lastCoverage`: `{ stmts, branches, runId, capturedISO }` from prior tick (for trend detection)
- `data.lastBreach`: `{ stmts, branches, runId, openedISO, issue }` or null
- `data.nextEligibleISO`: UTC ISO timestamp this job will next be eligible to act, computed from the cadence guard above. **Always emit this, every tick.** For this job: `data.lastRunISO + 20h`. Surfaced as "next run" on the dashboard.
- `done`: always `false`
