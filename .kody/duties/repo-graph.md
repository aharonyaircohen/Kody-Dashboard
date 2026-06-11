# Repo Graph — derive and refresh the orchestration graph

## Job

Daily derivation of a machine-readable graph of the repo's orchestration surface — context, duties, staff, executables, goals, and the issues attached to them — emitted as a structured report. The chat reads the report as a small, structured slice of the repo's shape without re-walking the filesystem every conversation. Detects decay: orphan staff, stale context, disabled-but-referenced, and rate-limited ticks.

**Cadence guard.** If `data.lastRunISO` is set and within the last 24 hours, emit unchanged state and exit. Otherwise proceed and update `data.lastRunISO` to now (UTC ISO).

**Per tick (one action max):**

1. Gather inputs:
   - List context entries: `gh api "/repos/$REPO/contents/.kody/context" -q '.[].name' | grep '\.md$'`
   - List duties: `gh api "/repos/$REPO/contents/.kody/duties" -q '.[].name' | grep '\.md$'`
   - List staff: `gh api "/repos/$REPO/contents/.kody/staff" -q '.[].name' | grep '\.md$'`
   - List executables (folders with profile.json): `gh api "/repos/$REPO/contents/.kody/duties" -q '.[] | select(.type=="dir") | .name'`
   - List existing reports: `gh api "/repos/$REPO/contents/.kody/reports" -q '.[].name' | grep '\.md$'`
   - Read each .kody file body via `gh api ... /contents/<path>` and base64-decode the content field (Read-equivalent)
   - Read prior graph report for byte-identical skip: `gh api "/repos/$REPO/contents/.kody/reports/repo-graph.md" -q '.content' | base64 -d`
   - Cross-reference goals via issues: `gh issue list --label "goal:" --state all --limit 200 --json number,title,labels`
   - Write the report via `gh api -X PUT /repos/$REPO/contents/.kody/reports/repo-graph.md` (base64 the body)
2. Compose the report findings as YAML frontmatter following this schema:

   ```yaml
   slug: repo-graph
   generatedAt: <ISO 8601 timestamp>
   findings:
   - id: repo-graph.snapshot
       severity: info
       title: Graph snapshot emitted
       data: { nodeCounts: { context, duties, staff, executables, goals, issues }, lastRunISO, nextEligibleISO, graphHash }
     - id: repo-graph.orphan-staff
       severity: medium
       title: <staff slug> — no duty, context, or executable references it
       data: { staff: <slug> }
     - id: repo-graph.stale-context
       severity: low
       title: <context slug> — not declared as reads_from by any duty
       data: { context: <slug> }
     - id: repo-graph.disabled-but-referenced
       severity: high
       title: <slug> — disabled but named in another duty's reads_from
       data: { slug, referencedBy: [<slugs>] }
     - id: repo-graph.coverage-gap
       severity: info
       title: <subfolder> — present in .kody/ but has no nodes
       data: { subfolder: <path> }
     - id: repo-graph.rate-limited
       severity: low
       title: Skipped — gh rate limit hit during tick
       data: { lastRunISO }
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

## Restrictions

- Never edit, create, or delete files in the working tree. The report is committed via the GitHub contents API, not the working tree.
- Never push, never commit any path other than `.kody/reports/repo-graph.md`.
- Maximum **one** report write per tick.
- If the contents PUT fails with 409 (sha mismatch), re-read the SHA and retry once; otherwise emit `cursor: error` and exit.
- Read-only on the working tree. Writes go through `gh api -X PUT` to the single path `.kody/reports/repo-graph.md`. Never `git commit` or `git push`.
- Daily only. 20h cadence guard (backstop). If the guard would have blocked, emit unchanged state and exit.
- Skip the PUT when the new body is byte-identical to the prior report (keeps git history clean).
- No LLM summarisation of file contents. Extract structured fields only (frontmatter, mentions, section names). The graph is data, not prose.
- Quiet on success: no comments, no inbox pings, no PRs, no labels. The report file is the only output.
- On any `gh` rate-limit error, emit a single `low` finding (id `repo-graph.rate-limited`), update `data.lastRunISO`, and exit cleanly. Never retry.

## State

- `cursor`: `idle` | `producing` | `error`
- `data.lastRunISO`: ISO timestamp of the last tick that ran (used by the cadence guard)
- `data.lastReportISO`: ISO timestamp of the last successful report write
- `data.findingCount`: count of findings in the last report (informational)
- `done`: always `false`
