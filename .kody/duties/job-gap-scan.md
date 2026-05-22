---
staff: ceo
---

# job-gap-scan

## Job

Once a day, propose **one** new high-ROI job the system does not yet
have. Read `.kody/memory/` first to honour prior verdicts — never
re-propose something the operator already dismissed or rejected, and
never propose something already in `.kody/jobs/`.

A proposal is **advisory only**. It surfaces as a GitHub issue labeled
`kody:ceo-proposal` containing the scoring table and a draft of the
job markdown. The operator decides Approve / Reject / Dismiss; this job
never writes a new job markdown itself.

## Tick procedure — REQUIRED

This tick is **fully scripted**. The script
[job-gap-scan-tick.py](.kody/scripts/job-gap-scan-tick.py) is the
**single source of truth** for cadence enforcement, candidate filtering,
issue creation, and state mutation.

Run the script:

```
python3 .kody/scripts/job-gap-scan-tick.py
```

The script:

1. Loads `state.json` (cadence guard: skip if `lastRunISO` within last
   6 days, unless `JOB_GAP_SCAN_FORCE=1`).
2. Reads `.kody/memory/` looking for any memory file whose `name` starts
   with `verdict-ceo-proposal-<slug>` to learn the operator's last
   verdict on each candidate.
3. Filters the built-in catalogue (`CATALOGUE` in the script) by:
   - Skipping slugs already filed as a job in `.kody/jobs/`.
   - Skipping slugs whose latest verdict is `reject` (permanent).
   - Skipping slugs whose latest verdict is `dismiss` within the last
     30 days (re-surface eligible after the cooling-off window).
   - Skipping slugs that already have an open `kody:ceo-proposal`
     issue with the matching title.
4. Picks the candidate with the highest ROI score from the filtered
   set. If nothing qualifies, narrates "no eligible proposals" and
   exits.
5. Creates the proposal issue:
   - Title: `ceo: propose new job — <slug>`
   - Label: `kody:ceo-proposal` (creates the label if missing).
   - Body: one-sentence headline, scoring table, "Why now" section,
     and a fenced block containing the draft job markdown.
6. Records `state.proposed[<slug>] = { firstSuggestedISO, openIssue }`
   and bumps `state.lastRunISO`. Commits + pushes the state file.

## Restrictions

- **One proposal per tick.** Never open more than one issue per run.
- **Never author code.** The job markdown inside the issue body is a
  draft the operator will approve, not a file you write.
- **Never re-surface a rejected slug.** A reject is permanent; only the
  catalogue maintainer (human) can revisit by changing the slug.
- **Dismiss has a 30-day cooling-off.** If signal grows after that,
  re-surface is allowed (but most dismissed slugs simply stay dismissed).
- **Stop on uncertainty.** If the script's filtered candidate list is
  empty, exit clean. Better to be silent than to propose noise.

## State

The script persists state in
[job-gap-scan.state.json](.kody/jobs/job-gap-scan.state.json) alongside
this file. Schema:

```json
{
  "lastRunISO": "2026-05-20T14:00:00Z",
  "proposed": {
    "sentry-digest": {
      "firstSuggestedISO": "2026-05-20T14:00:00Z",
      "openIssue": 73
    }
  }
}
```
