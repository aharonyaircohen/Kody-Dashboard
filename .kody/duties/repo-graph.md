# Repo Graph

## Job

Daily derivation of a machine-readable graph of the repo's orchestration surface — context, duties, staff, executables, and goal/issue edges. Emits a structured report at .kody/reports/repo-graph.md so the chat can read a small slice of the repo shape without walking the filesystem.

**Cadence guard.** If `data.lastRunISO` is set and within the last 24 hours, emit unchanged state and exit. Otherwise proceed and update `data.lastRunISO` to now (UTC ISO).

**Per tick (one action max):**

1. Gather inputs:
   - `ls .kody/context .kody/duties .kody/staff .kody/reports`
   - Read tool on every file under `.kody/` (read-only)
   - `gh issue list --label "goal:" --state all --limit 200 --json number,title,labels,state`
   - `gh api PUT /repos/{owner}/{repo}/contents/.kody/reports/repo-graph.md` (engine-supplied report-write path)
2. Compose the report findings as YAML frontmatter following this schema:

   ```yaml
   slug: repo-graph
   generatedAt: <ISO 8601 timestamp>
   findings:
   - id: graph-orphan-staff
       severity: medium
       title: Staff persona with no edges (orphaned)
       data: { staff: <slug>, referencedBy: [] }
     - id: graph-stale-context
       severity: low
       title: Context entry read by no current duty
       data: { context: <slug>, readers: [] }
     - id: graph-disabled-referenced
       severity: high
       title: Disabled duty still referenced by another duty or context
       data: { duty: <slug>, referencedBy: [<slug>, ...] }
     - id: graph-coverage-gap
       severity: low
       title: .kody subfolder present but not yet modeled as graph nodes
       data: { folder: <path>, suggestion: <string> }
     - id: graph-skipped-rate-limit
       severity: low
       title: Tick skipped — gh rate limit
       data: { resetISO: <iso> }
   ```

3. Look up the existing report's blob SHA (skip on 404 — first run):
   ```
   gh api repos/{owner}/{repo}/contents/.kody/reports/repo-graph.md \
     --jq .sha 2>/dev/null || echo ""
   ```
4. Commit the new report via the contents API (omit `-f sha=...` on first run):
   ```
   gh api -X PUT repos/{owner}/{repo}/contents/.kody/reports/repo-graph.md \
     -f message="chore(reports): update repo-graph" \
     -f content="$(printf '%s' "$REPORT_BODY" | base64)" \
     -f sha="$EXISTING_SHA"
   ```
5. On success, stash `data.lastReportISO = <now>` and `data.findingCount = <count>`. On non-2xx, set `cursor: error` and narrate the status code.

## Allowed Commands

- `gh api` — read + PUT contents on `.kody/reports/repo-graph.md` only
- `ls .kody/context .kody/duties .kody/staff .kody/reports`
- Read tool on files under `.kody/` (read-only)

## Restrictions

- Never edit, create, or delete files in the working tree. The report is committed via the GitHub contents API, not the working tree.
- Never push, never commit any path other than `.kody/reports/repo-graph.md`.
- Maximum **one** report write per tick.
- If the contents PUT fails with 409 (sha mismatch), re-read the SHA and retry once; otherwise emit `cursor: error` and exit.
- Read-only on the working tree. The only write is `.kody/reports/repo-graph.md` via `gh api PUT`; no `git commit`, no `git push`.
- Daily only (20h guard). Do not act twice inside a window.
- No PR, no issue comment, no inbox ping. This duty is silent — it produces a report that humans and other duties read.
- No LLM summarisation of file contents. Extract structured fields only — the graph is data, not prose.
- On `gh` rate-limit, emit a `graph-skipped-rate-limit` finding and exit cleanly. Do not retry inside the same tick.

## State

- `cursor`: `idle` | `producing` | `error`
- `data.lastRunISO`: ISO timestamp of the last tick that ran (used by the cadence guard)
- `data.lastReportISO`: ISO timestamp of the last successful report write
- `data.findingCount`: count of findings in the last report (informational)
- `done`: always `false`
