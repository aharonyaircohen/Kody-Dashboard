---
agent: [*]
---

# Orchestration Conventions

Agents should leave small, machine-readable breadcrumbs when work crosses hands.

## Claim and done markers

Use these hidden issue-comment markers:

```html
<!-- claim: <short statement of intent, assumption, or decision> -->
<!-- done: <short statement of the completed outcome> -->
```

Rules:

- Add `claim` before non-trivial action when another agent may need to know what is being tried.
- Add `done` when closing or completing work.
- Keep marker text short and factual.
- Do not add markers for tiny status updates.
- Treat a claim older than 4 hours with no done marker and no newer activity as stale unless the duty says otherwise.

## Reports

Reports in `.kody/reports/*.md` must start with YAML frontmatter that follows `.kody/reports/_schema.yaml`.

Every report has `generatedAt` and `findings`; every finding has `id`, `severity`, and `title`, with optional `data` and `linkedUrl`.
