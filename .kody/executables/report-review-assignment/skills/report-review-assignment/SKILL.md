---
name: report-review-assignment
description: Scan generated reports and assign action-needed findings to the correct reviewer.
---

# Report Review Assignment Skill

Use this skill when the `report-review-assignment` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

Scan reports in `kody-state:.kody/reports/*.md`. Only act on reports whose
frontmatter says:

```yaml
reviewStatus: action-needed
```

Use `reviewArea` to choose the reviewer. The report producer does not name a
staff member; assignment belongs here.

## Reviewer Routing

| reviewArea | Reviewer | Use for |
| --- | --- | --- |
| `engineering-capability` | `cto` | skills, executables, code quality, architecture, CI |
| `operations` | `coo` | duty health, orchestration, stale process, run hygiene |
| `quality` | `qa` | QA reports, regressions, browser findings |
| `documentation` | `tech-writer` | docs drift, docs coverage |
| `design` | `ux-designer` | UI design and usability reports |
| `staff-performance` | `ceo` | staff delivery/performance reports |

If `reviewArea` is missing or unknown, assign to `coo` for manual routing.

## Tick Procedure

1. Resolve the repo with `gh repo view --json nameWithOwner -q .nameWithOwner`.
2. List reports from `kody-state:.kody/reports`.
3. Read each report and parse frontmatter.
4. Keep only `reviewStatus: action-needed`.
5. For each candidate, compute a stable assignment key:
   `report-review:<report-slug>:<report-sha>`.
6. Skip if an open assignment issue already contains that key.
7. Create at most one assignment issue this tick.

## Assignment Issue

Create or reuse the label `kody:report-review`.

Issue title:

```text
Report review: <report title>
```

Issue body:

```md
Review assignment for `<report-slug>`.

- **Reviewer:** `<reviewer>`
- **Review area:** `<reviewArea>`
- **Source duty:** `<dutySlug>`
- **Report:** <report URL>

This issue assigns review only. Do not solve the finding here.

<!-- kody-report-review-key: report-review:<report-slug>:<report-sha> -->
<!-- kody-reviewer: <reviewer> -->
```

## Allowed Commands

- `gh repo view`
- `gh api` reads for `kody-state:.kody/reports`
- `gh issue list`
- `gh label create`
- `gh issue create`

## Restrictions

- Do not solve findings.
- Do not edit reports.
- Do not edit duties, executables, source files, or skills.
- Do not install skills.
- Create at most one assignment issue per tick.
- Never assign reports with `reviewStatus: none`, `info`, `assigned`, or `reviewed`.
