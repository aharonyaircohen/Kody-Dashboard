---
name: "Kody dispatch uses bare @kody"
description: "Use bare @kody comment to trigger pipeline, not @kody run"
type: feedback
created: 2026-06-01T18:09:41.386Z
---

When dispatching Kody on an issue, post `@kody` (bare, no "run" suffix). The engine picks up its default executable automatically. The `run` subcommand may not be recognized when no custom executables are defined.

**Why:** The repo's kody.yml workflow triggers on `issue_comment` events and the kody-engine parses bare `@kody` as the default command. `@kody run` was causing failures.
**How to apply:** Always use `github_comment_on_issue` with body `@kody` for issue dispatch; never append `run`.
