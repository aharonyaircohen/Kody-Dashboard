# Kody Health Check

## Job

Daily digest of **tasks already assigned to Kody** — any open issue carrying an active `kody:*` lifecycle label other than `kody:done` — that **haven't been updated in the last 6 hours**. Purely diagnostic: never re-kicks, closes, or relabels anything. The operator reads the digest and decides what (if anything) to nudge.

**Cadence guard.** If `data.lastRunISO` is set and within the last 20 hours, emit unchanged state and exit. Otherwise proceed and update `data.lastRunISO` to now (UTC ISO) when you write the report.

**Per tick (one action max):**

1. For each label below, list open issues and **filter client-side** to those whose `updatedAt` is older than `now - 6h`:

   ```
   gh issue list --state open --label "<label>" --json number,title,url,updatedAt --limit 100
   ```

   Labels to scan:
   - `kody:queued`, `kody:running`, `kody:fixing`, `kody:resolving`, `kody:reviewing`, `kody:syncing`, `kody:needs-fix`, `kody:failed`

2. Build the report markdown. Lead with an `# Kody Health Check` H1, then a `_Threshold: 6h_` line (no timestamp — `lastRunISO` lives in state, not in the file body, so unchanged scans produce a byte-identical report). Then sections grouped by phase. Each line:
   `- [#<n>](<url>) — <title> — <hoursStale>h since last update`

   `<hoursStale>` must be rounded to a **whole integer** (e.g. `338h`, not `338.8h`) so minor drift between ticks doesn't churn the file.

   If every phase reports zero stuck issues, the body after the H1 is one line: `All Kody-assigned tasks were updated within the last 6h. ✨`. Skip empty phases — keep the report short.

3. Write the report at the canonical path **`.kody/reports/health-check.md`** via `gh api`:

   ```
   # If the file exists, fetch its sha first:
   sha=$(gh api "/repos/<owner>/<repo>/contents/.kody/reports/health-check.md" -q .sha 2>/dev/null || true)

   # Then PUT the new content (base64-encoded):
   gh api -X PUT "/repos/<owner>/<repo>/contents/.kody/reports/health-check.md" \
     -f message="chore(health-check): refresh report" \
     -f content="$(printf '%s' "$REPORT_BODY" | base64)" \
     -f branch="<defaultBranch>" \
     ${sha:+-f sha="$sha"}
   ```

   `<owner>`, `<repo>`, and `<defaultBranch>` come from the GitHub context — for A-Guy they are `A-Guy-educ`, `A-Guy`, `dev`.

   If the rendered body is byte-identical to the existing file, **skip the PUT** (the GitHub API would no-op anyway, but skipping keeps git history clean).

4. Update state: `cursor: reported`, `data.lastRunISO = <now ISO>`, `data.lastStuckCount = <total>`.

## Allowed Commands

- `gh issue list`, `gh issue view` — to read scan input.
- `gh api -X PUT` against `.kody/reports/health-check.md` only — to write the report. Permitted by the global job-tick contract.

## Restrictions

- **Never** edit, close, label, or re-kick the issues being scanned. Read-only on the scanned issues.
- **Never** create or comment on issues from this job. Output is the report file only.
- **Never** write any other file. The contract permits exactly one path: `.kody/reports/health-check.md`.
- Maximum **one** PUT per tick.
- "Stuck" threshold is **6 hours** since `updatedAt`. It's set here in the body — don't infer it from data.
- `kody:done` is **never** included in the scan. That's a terminal state.

## State

- `cursor`: `idle` | `reported` | `stalled`
- `data.lastRunISO`: ISO timestamp of the last tick that wrote the report (or null)
- `data.lastStuckCount`: count of stuck tasks in the last report (or 0)
- `data.nextEligibleISO`: UTC ISO timestamp this job will next be eligible to act, computed from the cadence guard above. **Always emit this, every tick.** For this job: `data.lastRunISO + 20h`. Surfaced as "next run" on the dashboard.
- `done`: always `false` — this job is evergreen.
