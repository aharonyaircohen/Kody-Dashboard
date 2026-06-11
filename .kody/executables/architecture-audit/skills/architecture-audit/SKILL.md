---
name: architecture-audit
description: Run a periodic architecture-health sweep for boundaries, coupling, dependency direction, dead abstractions, and duplication.
---

# Architecture Audit Skill

Use this skill when the `architecture-audit` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

## Jobs

Periodic **architecture-health sweep** of the codebase — boundaries and coupling, not line-level style. The job itself cannot run shell beyond `gh`, so it opens a tracking issue delegating the analysis to a Kody executable in CI and tracks the result.

Scope of the delegated sweep:

- **Module boundaries / single responsibility** — god-modules and god-routes that have accreted multiple jobs.
- **Dependency direction** — layering violations (a shared/core util importing a feature/app layer) and any import cycles.
- **Premature / dead abstractions** — interfaces or layers with a single implementation and no second caller; abstractions no longer used.
- **Duplication** — logic re-implemented where an existing sibling already solves it.

**Per tick (one action max):**

1. Check whether an open tracking issue exists:
   `gh issue list --label "kody:architecture-audit" --state open --json number,title,createdAt,body`
2. If an open issue exists AND was created in the last 48 hours, emit state with `cursor: awaiting-result` and exit (the sweep is in flight; don't double-trigger).
3. If an open issue exists older than 48 hours with no `/kody` activity, post a single nudge comment:
   ```
   gh issue comment <n> --body "Architecture sweep appears stalled. /kody chore: re-run the architecture-health analysis and post the report."
   ```
   Then exit.
4. Otherwise (no open issue), open one:
   ```
   gh issue create \
     --title "architecture: health sweep $(date -u +%Y-%m-%d)" \
     --label "kody:architecture-audit" \
     --body "/kody chore: run a read-only architecture-health analysis and post a single report comment grouped by severity (BLOCK / WARN). Cover: module boundaries & single responsibility (god-modules/routes), dependency direction (layering violations, import cycles), premature or dead abstractions, and duplication of an existing sibling. Cite real file:line for every finding and name the existing pattern each should follow. Open a fix PR ONLY for a finding that creates a concrete, demonstrable risk (a new dependency cycle, a layering violation that breaks an invariant); leave design-preference findings as report bullets, not PRs."
   ```
   Stash `data.openIssue = <number>`.

## Allowed Commands

- `gh issue list`, `gh issue create`, `gh issue comment`, `gh issue view`

## Restrictions

- Never edit files. Never push. Never run build/test/lint tools directly — delegation via `/kody chore` only.
- Maximum **one** issue created or commented per tick.
- If `gh issue create --label kody:architecture-audit` fails because the label doesn't exist, run `gh label create kody:architecture-audit --description "Kody job: architecture audit"` and retry the create. **Do not skip the label** — the next-tick "is sweep in flight?" check depends on it.
- Never close an issue from this job — let any fix PRs auto-close via `Closes #N`, and close report-only issues manually after review.
