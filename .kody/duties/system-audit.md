---
every: 30m
staff: coo
---

# System Audit

# System Audit

## Job

Audit the coordination of jobs and workers in `.kody/`. Walk the
definitions and their sibling state files, run a fixed set of integrity
checks, and post one consolidated comment on the **Kody system audit**
tracking issue so the operator sees it in the inbox. Purely diagnostic:
never edits, re-kicks, or relabels anything outside posting the comment.

**Cadence guard.** If `data.lastRunISO` is set and within the last 30
minutes, exit with no comment and emit unchanged state. Otherwise
proceed and set `data.lastRunISO` to now (UTC ISO) before emitting state.

**Per tick (one action max):**

1. **Enumerate definitions** via the GitHub contents API:
   - Jobs: `gh api "/repos/<owner>/<repo>/contents/.kody/jobs" -q '.[].name'`
   - Workers: `gh api "/repos/<owner>/<repo>/contents/.kody/workers" -q '.[].name'`

   For each `<slug>.md` in `.kody/jobs/`, fetch its body to read the
   frontmatter (`disabled`, `worker`, `every`). For each `<slug>.md` in
   `.kody/workers/`, the slug alone is enough. Also note which jobs
   have a sibling `<slug>.state.json` and read its `data` block.

2. **Run the seven checks.** For each violation, record one line in the
   findings under its section. Mechanical findings include a `**Fix:**`
   line; non-mechanical ones don't (the operator investigates).

   1. **Broken worker reference** *(mechanical)* — job's `worker:`
      field names a slug that does not exist in `.kody/workers/`.
      Fix: create `.kody/workers/<slug>.md` (identity-only) or correct
      the job's `worker:` field.
   2. **Orphan worker** — worker file exists but no enabled job
      references it. `cto`, `coo`, and the auditor's own worker are
      exempt if no job currently uses them. No mechanical fix
      (operator decides whether to delete or leave as standby).
   3. **Missed tick** — job is enabled, has an `every:` cadence, and
      its `state.json` `data.lastRunISO` is older than `now - 2 ×
      cadence`. Jobs with `every: manual` or no cadence are skipped.
      No mechanical fix (often transient cron skew).
   4. **Missing state** *(mechanical)* — job has been ticked (body
      changed since creation, or commits touched it) but no
      `<slug>.state.json` file exists. Without state nothing
      future-gates it; it will re-fire on every wake.
      Fix: add a closing `kody-job-next-state` fenced JSON block to
      the job body so the engine writes `<slug>.state.json` on every
      tick.
   5. **Cooldown violated** — `data.lastRunISO` is more recent than
      `data.nextEligibleISO` was the tick before it. Detect by reading
      the file's git history for `state.json` and checking that each
      `lastRunISO` is `≥` the previous commit's `nextEligibleISO`.
      List up to the 3 most recent violations per job. No mechanical
      fix (often indicates an engine or job-body bug worth
      investigating).
   6. **Stuck dispatch** — `cursor` field in state is non-terminal
      (anything other than `idle`, `reported`, `done`) and
      `data.lastRunISO` is older than `now - 2h`. No mechanical fix
      (operator decides whether it's stuck or merely slow).
   7. **Duplicate dispatch** — same job's `state.json` shows two
      `lastRunISO` commits within 60 seconds of each other in the
      last 24 hours of history. List job slug and the timestamp pair.
      No mechanical fix (root cause varies — could be the engine,
      could be webhook re-delivery).

3. **Pin the repo, then find or open the tracking issue.**
   `gh` CLI's default repo is not guaranteed in this context. **Always
   pass `--repo` explicitly** to every `gh issue` call below. Resolve
   it once from the checked-out working tree:
   ```
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   ```
   Then look for an open issue titled exactly **`Kody system audit`**
   in that repo:
   ```
   issue_number=$(gh issue list --repo "$REPO" --search "Kody system audit in:title" --state open --limit 1 --json number -q '.[0].number')
   ```
   If empty, open it once with a stable body explaining its purpose
   (one-time setup; subsequent ticks just comment):
   ```
   gh issue create --repo "$REPO" \
     --title "Kody system audit" \
     --body "Tracking issue for the system-audit job. Each tick that finds violations posts a comment here so the operator sees it in the inbox. Read-only — never close."
   ```

4. **Skip on clean.** If every check passes, **do not comment.** The
   inbox stays quiet on healthy ticks. Still emit fresh state in
   step 5.

5. **Post the comment** when there are violations. Lead with
   `## System Audit — <total> finding(s)` then one section per check
   that has at least one violation:

   ````
   ## System Audit — 1 finding(s)

   ### Missing state
   - `pr-health-triage` → no `state.json`; will re-fire on every wake.
     **Fix:** add a closing `kody-job-next-state` block to the body.
   ````

   Post with:
   ```
   gh issue comment "$issue_number" --repo "$REPO" --body "$COMMENT_BODY"
   ```

6. **Emit closing state.** As the very last thing in your reply,
   output a fenced block exactly like this (the engine parses it to
   write `system-audit.state.json` — without it the auditor itself
   re-fires every wake, which is one of the violations it's
   supposed to flag):

   ````
   ```kody-job-next-state
   {
     "cursor": "reported",
     "data": {
       "lastRunISO": "<now ISO>",
       "nextEligibleISO": "<now ISO + 30m>",
       "lastFindingCount": <total>
     },
     "done": false
   }
   ```
   ````

## Allowed Commands

- `gh api` reads against `/repos/<owner>/<repo>/contents/.kody/jobs`,
  `/repos/<owner>/<repo>/contents/.kody/workers`, individual file
  contents, and `/repos/<owner>/<repo>/commits` for state history.
- `gh issue list --search "Kody system audit in:title" --state open` —
  to find the tracking issue.
- `gh issue create --title "Kody system audit" ...` — one-time only
  if the issue doesn't exist yet.
- `gh issue comment <n> --body "..."` against the **Kody system audit**
  issue only — to post the findings.

## Restrictions

- **Read-only on everything except the tracking issue.** Never edit,
  delete, rename, label, or re-kick any job, worker, state file,
  comment, PR, or other issue.
- **At most one issue comment per tick.** Only on the Kody system
  audit issue.
- **No file writes.** This job never modifies the working tree.
- **Quiet on clean** — no comment when zero violations. The inbox
  is precious; do not spam it.
- Auditor's own job (`system-audit`) and worker (`coo`) are exempt
  from the orphan check on themselves — don't flag yourself.
- The "stuck dispatch" and "cooldown violated" checks are heuristic.
  Surface them; the operator decides whether they're real.

## State

- `cursor`: `reported` after a tick that emitted findings (commented
  or not).
- `data.lastRunISO`: UTC ISO timestamp of the last tick that ran past
  the cadence guard.
- `data.nextEligibleISO`: UTC ISO timestamp this job will next be
  eligible to act, always `lastRunISO + 30m`. **Always emit this,
  every tick** — surfaced as "next run" on the dashboard.
- `data.lastFindingCount`: total violations found in the most recent
  scan (0 on a clean tick).
- `done`: always `false` — this job is evergreen.
