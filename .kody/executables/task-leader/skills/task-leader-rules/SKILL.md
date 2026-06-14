# Task Leader Rules

## Operator-tunable knobs (read from `.kody/duties/task-leader/profile.json`)

- `readyPreviewCap` (default `15`) — max issues with `status:ready-for-preview` before the duty backs off.
- `smallChangeMaxLines` (default `200`) — total lines changed (additions + deletions) for a PR to be "small".
- `smallChangeMaxFiles` (default `20`) — max files changed for a PR to be "small".
- `staleReviewHours` (default `4`) — hours a PR can sit without both reviews approved before escalation.
- `blockAutoMergeLabel` (default `status:needs-review`) — label that blocks auto-merge.
- `dispatchComment` (default `@kody`) — bare token that dispatches a backlog issue.
- `tripwirePaths` (default list below) — folders/files whose presence in a PR's diff disqualifies auto-merge.

Default tripwire paths:
- `db/`, `migrations/`, `prisma/`, `schema/`, `models/`
- `.github/`, `Dockerfile`, `package.json`
- `auth/`, `middleware/`

## Step 1 — Queue cap check

Count open issues with label `status:ready-for-preview`:

```
gh issue list --state open --label status:ready-for-preview --json number --jq 'length'
```

If count >= `readyPreviewCap`, log "queue full, exiting" and stop. Do not run any other step this tick.

## Step 2 — Request missing reviews

For each open PR, check BOTH verdicts:

- Code review verdict:
  ```
  gh pr view <N> --json reviewDecision -q .reviewDecision
  ```
  Treat `APPROVED` as the code review passing.

- UI review verdict: treat the presence of a comment from a kody-bot account containing `@kody ui-review` followed by an approval reaction (👍) as the UI verdict. If no such signal exists, treat as missing.

For each missing verdict, post as a SEPARATE comment:

- If code review missing → `gh pr comment <N> --body "@kody review"`
- If UI review missing → `gh pr comment <N> --body "@kody ui-review"`

Before posting, check the PR's existing comments to avoid duplicates:
```
gh pr view <N> --comments --json comments --jq '.comments[].body'
```

## Step 3 — Request fixes for PRs with concerns

For each open PR, check if EITHER:

- `reviewDecision` equals `CHANGES_REQUESTED`, OR
- The PR has unresolved review threads

If either is true AND no `@kody fix` comment has been posted since the last review update, post:
```
gh pr comment <N> --body "@kody fix"
```

## Step 4 — Auto-merge safe small PRs

For each open PR, ALL of the following must be true to merge:

1. Code review verdict is `APPROVED`.
2. UI review verdict is `APPROVED` (per the convention in Step 2).
3. All required CI checks pass: `gh pr checks <N>`.
4. The PR's linked issue does NOT have label `blockAutoMergeLabel`:
   ```
   gh pr view <N> --json closingIssuesReferences
   ```
   For each referenced issue, check labels with `gh issue view <M> --json labels`.
5. The PR's diff is "small":
   ```
   gh pr view <N> --json additions,deletions,changedFiles
   ```
   Total of additions + deletions <= `smallChangeMaxLines`, AND changedFiles <= `smallChangeMaxFiles`.
6. The PR's changed files do NOT touch any path in `tripwirePaths`:
   ```
   gh pr view <N> --json files --jq '.files[].path'
   ```
   For each file, check it doesn't start with any tripwire path.

If all 6 pass, run:
```
gh pr merge <N> --squash --delete-branch=false
```

If any check fails, skip the PR and log why.

## Step 5 — Dispatch the next backlog task

Re-count `status:ready-for-preview` (it may have changed in steps 2–4). If still < `readyPreviewCap`:

1. Find the highest-priority open issue with NO PR, with label `status:verified`, and WITHOUT labels `status:needs-human`, `status:blocked`, or `status:ready-for-preview`:
   ```
   gh issue list --state open --label status:verified --json number,title,labels --limit 100
   ```
2. Sort by priority label (P0 > P1 > P2 > P3), oldest first within the same priority.
3. Post the dispatch comment on the first match:
   ```
   gh issue comment <N> --body "<dispatchComment>"
   ```

If no matching issue, log "no eligible backlog task" and continue.

## Step 6 — Escalate stale PRs

For each open PR, check if it's been open longer than `staleReviewHours` AND does NOT have both reviews approved. If so, post a comment mentioning the operator(s):

```
gh pr comment <N> --body "<@operator1, @operator2> this PR has been waiting for review for more than <staleReviewHours> hours."
```

To get the operator list, read the `operators` field from `kody.config.json` at the repo root.

## Final output (required)

Your final message must use this exact format:

```
DONE
PR_SUMMARY:
- step1: queue count = <N>
- step2: reviews requested = <N>
- step3: fixes requested = <N>
- step4: merges = <N> (list of PR numbers)
- step5: dispatches = <N> (list of issue numbers)
- step6: escalations = <N> (list of PR numbers)
```

If a step errors fatally, output:
```
FAILED: <step name> — <error>
```
