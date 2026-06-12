---
name: system-audit
description: Audit Kody duty, staff, executable, report, and runtime-state wiring.
---

# System Audit Skill

Use this skill when the `system-audit` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

Audit the coordination surface under `.kody/`. This is a structural check, not a
fixer. Post one consolidated comment on the Kody system audit tracking issue
only when findings exist.

## Scope

Check:

- duties in `.kody/duties/<slug>/` (`profile.json` plus `duty.md`)
- staff in `.kody/staff/*.md`
- executables in `.kody/executables/*/`
- reports in `.kody/reports/*.md`
- context in `.kody/context/*.md`
- runtime state/history when the engine exposes it

## Checks

1. **Broken staff reference:** A duty profile names `"staff": "<slug>"` but `.kody/staff/<slug>.md` does not exist.
2. **Missing executable reference:** A duty profile names an executable but `.kody/executables/<slug>/profile.json` does not exist.
3. **Invalid stage:** A duty profile has no `stage` or uses a stage outside the built-in templates.
4. **Old duty shape:** A duty body contains raw state schemas, `kody-job-next-state`, long shell recipes, or staff/persona prompts.
5. **Broken executable shape:** An executable has invalid `profile.json`, a large explanatory `prompt.md`, missing declared skills, or shell steps pointing to missing files.
6. **Stale report:** A report-refresh duty has no report, an empty report, or a report older than expected for its cadence.
7. **Stuck runtime:** Runtime evidence shows a non-terminal state stuck well beyond the duty cadence.
8. **Orphan staff:** A staff file owns no active duty. Report as informational, not broken.

## Tick Procedure

1. Resolve the repo with `gh repo view --json nameWithOwner -q .nameWithOwner`.
2. Read the directories listed in Scope.
3. Run the checks above.
4. If there are no findings, stay quiet.
5. If there are findings, find or open the tracking issue titled `Kody system audit`.
6. Post one grouped comment:

```md
## System Audit - <n> finding(s)

### Broken staff reference
- `duty-slug` names missing staff `x`. Fix: create `.kody/staff/x.md` or change the duty.
```

## Allowed Commands

- `gh repo view`
- `gh api` reads for `.kody/duties`, `.kody/staff`, `.kody/executables`, `.kody/reports`, `.kody/context`, and history/state when available
- `gh issue list`, `gh issue create`, and `gh issue comment` only for the Kody system audit tracking issue

## Restrictions

- Read-only except for the system-audit tracking issue.
- Do not edit duties, staff, executables, reports, context, labels, PRs, or state.
- Do not re-kick work.
- One tracking issue comment at most per tick.
- Stay quiet when there are no findings.
