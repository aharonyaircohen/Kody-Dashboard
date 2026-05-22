---
staff: kody
disabled: true
---

# Doc Drift

# Doc Drift

## Job

Read the latest doc-drift scanner report and open one tracking issue per unescalated finding. The job does **not** scan — it only consumes `.kody/reports/doc-drift.md` and orchestrates the issue lifecycle. The scanner that produces the report file is a separate primitive (TBD).

**Cadence guard.** Read `.kody/reports/doc-drift.md` (Read tool — file is in the working tree). Parse the YAML frontmatter. If the file is missing, narrate "no report available" and exit with `cursor: idle`. Otherwise:

- If `report.generatedAt <= data.lastReportGeneratedAt`, no new report has been published since the last tick — emit unchanged state and exit.
- Otherwise this is a fresh report. Proceed.

**Per tick (one issue per unescalated finding — batch is OK because this is bookkeeping, not delegation):**

1. List existing open tracking issues:
   `gh issue list --label "kody:doc-drift" --state open --json number,title --limit 50`
2. For each `report.findings[i]`:
   - Compute the expected issue title: `doc-drift: <finding.data.srcArea>` (use `data.srcArea` verbatim — the slash-containing path is fine in titles).
   - If an open issue with that exact title already exists in the result above, skip — it's already tracked.
   - Otherwise, open a new issue. **If the label `kody:doc-drift` does not exist, run `gh label create kody:doc-drift --description "Kody job: doc drift"` first and retry. Do NOT skip the label.**
     ```
     gh issue create \
       --title "doc-drift: <finding.data.srcArea>" \
       --label "kody:doc-drift" \
       --body "<see body template below>"
     ```
3. After processing all findings, update `data.lastReportGeneratedAt = report.generatedAt` and `data.lastEscalatedFindings = [<id>, ...]`.

### Issue body template

For each finding, the issue body should describe the finding (not request a scan). Format:

```
**Finding:** <finding.title>

- **Source area:** `<finding.data.srcArea>`
- **Severity:** <finding.severity>
- **Source commits in last <report.scope.srcWindowDays>d:** <finding.data.srcCommits14d>
- **Doc commits in last <report.scope.docsWindowDays>d:** <finding.data.docsCommits30d>
- **Expected doc paths:** <finding.data.expectedDocsPaths joined as `code, code, code`>
- **Recent SHAs:** <finding.data.recentSrcShas joined as `code, code, code`>

See [.kody/reports/doc-drift.md](.kody/reports/doc-drift.md) for the full scanner report (generatedAt: <report.generatedAt>).

/kody chore: review the recent changes in `<finding.data.srcArea>`, identify documentation that needs updating in <expectedDocsPaths>, and open a PR with the doc updates. If no docs need updating, close this issue with a comment explaining why.
```

## Allowed Commands

- `gh issue list`, `gh issue create`, `gh label create`
- Read tool on `.kody/reports/doc-drift.md` only.

## Restrictions

- Never edit, create, or delete files in the working tree. (Reading the report file is fine — Read tool is allowed.)
- Never push, never commit.
- Never run `gh api repos/.../commits` or any commit-walking analysis — that's the scanner's job, not this job's.
- One issue per unescalated finding per tick (batch is allowed because this is fast bookkeeping, not slow delegation).
- Skip a finding if an issue with the matching title already exists in the open-issues list (the dedup key is the title's `<srcArea>` suffix).
- If `gh issue create --label kody:doc-drift` fails because the label doesn't exist, run `gh label create kody:doc-drift` and retry. Do not skip the label.

## State

- `cursor`: `idle` | `processed` | `no-report`
- `data.lastReportGeneratedAt`: ISO timestamp of the last report this job processed (set to `report.generatedAt` after a successful pass)
- `data.lastEscalatedFindings`: `[<findingId>, ...]` — list of finding ids escalated against the most-recent report (informational; the dedup truth is the open-issue list, not this field)
- `data.lastRunISO`: ISO timestamp of the last tick that took action
- `data.nextEligibleISO`: this job is **report-driven, not time-driven** — eligibility depends on whether the report's `generatedAt` differs from `data.lastReportGeneratedAt`. **Always emit this**, but set it to `null` (the dashboard renders "next run unknown" for null).
- `done`: always `false`
