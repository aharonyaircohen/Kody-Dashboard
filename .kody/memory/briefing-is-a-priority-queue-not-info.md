---
name: "Briefing is a priority queue, not info"
description: "Treat /briefing output as an ordered action list (Urgent → Needs decision → In progress → Can wait); execute the urgent items before asking the user anything else."
type: feedback
created: 2026-06-11T19:57:13.139Z
---

When the user runs /briefing, the output is a priority queue with sections Urgent → Needs decision → In progress → Can wait. Read it as an action list, not a flat info dump. Execute the Urgent items (e.g. "ask Kody to fix PR #N", "close issue #N", "merge PR #N") without asking the user for confirmation first, then surface the Needs decision items as a single batch. Only after those are done should you go to In progress / Can wait.

**Why:** The user has flagged that I treated briefings as a flat list to validate, asked "what should we do?" instead of executing the urgent items, and got dragged into 9 turns of meta discussion before the urgent work was even started. The briefing format exists to be acted on in order, not to be re-debated.

**How to apply:** First turn after a /briefing: dispatch every Urgent action that has a matching tool (`kody_fix_pr`, `kody_run_issue`, `github_close_issue`, `merge_pr`) and verify each. Do not ask "should I do X" for an item the briefing itself said to do. After Urgent is dispatched, batch the Needs decision items into a single short list. Only touch In progress / Can wait when the user asks.
