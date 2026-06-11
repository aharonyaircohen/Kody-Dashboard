# Repo Graph Executable

Build the machine-readable orchestration graph and refresh
`.kody/reports/repo-graph.md`.

This prompt defines only the runnable procedure. Staff identity, schedule,
purpose, and safety policy come from the duty and staff files.

# Repo

{{repoOwner}}/{{repoName}}, default branch: {{defaultBranch}}

{{conventionsBlock}}

# Inputs

Read these repo surfaces:

- `.kody/context/*.md`
- `.kody/duties/*.md`
- `.kody/staff/*.md`
- `.kody/executables/*/profile.json`
- `.kody/reports/*.md`
- GitHub issues labelled `goal:*`

# Procedure

1. Pin the repo:

   ```bash
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
   ```

2. Read the `.kody` files with `gh api /repos/$REPO/contents/<path>`.
   Decode `.content` with `base64 -d`.

3. Extract structured fields only:
   - slug
   - title
   - frontmatter fields
   - section headings
   - declared `staff`, `executables`, `reads_from`, `writes_to`, `done_when`
   - report `findings`

4. Build graph nodes for context, duties, staff, executables, reports, goals,
   and issues. Build edges from declared references and obvious ownership
   fields, such as a duty's `staff:` and `executables:`.

5. Emit `.kody/reports/repo-graph.md` with YAML frontmatter:

   ```yaml
   ---
   slug: repo-graph
   generatedAt: <ISO timestamp>
   findings:
     - id: repo-graph.snapshot
       severity: info
       title: Graph snapshot emitted
       data:
         nodeCounts: { context: 0, duties: 0, staff: 0, executables: 0, reports: 0, goals: 0, issues: 0 }
         graphHash: <stable hash>
     - id: repo-graph.orphan-staff
       severity: medium
       title: <staff slug> - no duty, context, or executable references it
       data: { staff: <slug> }
     - id: repo-graph.stale-context
       severity: low
       title: <context slug> - not declared as reads_from by any duty
       data: { context: <slug> }
     - id: repo-graph.disabled-but-referenced
       severity: high
       title: <slug> - disabled but named in another duty's reads_from
       data: { slug: <slug>, referencedBy: [<slugs>] }
     - id: repo-graph.coverage-gap
       severity: info
       title: <subfolder> - present in .kody/ but has no nodes
       data: { subfolder: <path> }
   ---
   ```

   Add a short markdown body after the frontmatter with the graph summary.

6. Compare against the current report. Skip the PUT when the new body is
   byte-identical to the current report.

7. Write through the GitHub contents API only:

   ```bash
   sha=$(gh api "/repos/$REPO/contents/.kody/reports/repo-graph.md" -q .sha 2>/dev/null || true)
   gh api -X PUT "/repos/$REPO/contents/.kody/reports/repo-graph.md" \
     -f message="chore(reports): refresh repo-graph" \
     -f content="$(printf '%s' "$REPORT_BODY" | base64)" \
     -f branch="$DEFAULT_BRANCH" \
     ${sha:+-f sha="$sha"}
   ```

# Error Handling

- On a 409 SHA mismatch, re-read the SHA and retry once.
- On any GitHub rate-limit error, write a `repo-graph.rate-limited` finding if
  possible, then stop. Do not retry rate-limited calls.
- On any other failed PUT, report `FAILED: <status and reason>`.

# Boundaries

- Never edit files in the working tree.
- Never run `git`.
- Never push.
- Never write any path except `.kody/reports/repo-graph.md`.
- Maximum one successful report PUT per run.
- Do not summarize file prose. Extract structured fields only.
- Keep output quiet: no issue comments, PRs, labels, inbox pings, or
  dispatches.

# Final Message

Use exactly one of:

```text
DONE
COMMIT_MSG: chore(reports): refresh repo-graph
PR_SUMMARY:
- Refreshed .kody/reports/repo-graph.md.
- Findings: <count>.
```

```text
DONE
COMMIT_MSG: chore(reports): refresh repo-graph
PR_SUMMARY:
- No report write needed; repo graph was unchanged.
```

Or:

```text
FAILED: <short reason>
```

<!-- kody:output-format (managed - edit above this line only) -->
