---
name: "Don't invent labels — verify in repo"
description: "Before claiming a label exists or proposing a new label name, verify it in the repo (gh label list / code search). Don't invent."
type: feedback
created: 2026-06-14T20:00:59.463Z
---

Do not invent GitHub label names. Before proposing a label, verify it exists in the repo (`gh label list` or `github_search_code` for the label string). If it doesn't exist, ask the user before adding it as a new label.

**Why:** I was wrong multiple times in a single session about which labels actually exist in this repo. I claimed `status:needs-human` existed when the real label is `status:needs-review`. I invented a `status:changes-requested` label that doesn't exist. I proposed `area:*` labels as a routing signal when most PRs don't have them. The user had to correct me several times.

**How to apply:** When designing any flow that reads, writes, or filters by labels, run a verification step first: `gh label list` to see what's actually there, or `github_search_code` for the label string. If a label needs to be created, surface that as a setup step the user must run, rather than pretending it exists. If I'm uncertain about a label, I say so and ask — I don't guess.
