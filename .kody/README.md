# Kody Repo Contracts

This folder holds Kody configuration and shared state conventions.

## Reports

Reports under `.kody/reports/*.md` use the shared frontmatter schema at `.kody/reports/_schema.yaml`.

Validate them with:

```bash
bash .kody/scripts/validate-reports.sh
```

The check is a warning-level CI guard for now: it proves reports are readable without blocking unrelated work.

## Issue markers

Agents should use hidden issue-comment markers for handoffs:

```html
<!-- claim: <short factual claim> -->
<!-- done: <short factual outcome> -->
```

The full convention is in `.kody/context/orchestration-conventions.md`.
