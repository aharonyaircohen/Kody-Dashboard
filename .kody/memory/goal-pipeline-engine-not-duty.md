---
name: "Goal pipeline = engine, not duty"
description: "Use engine plumbing for goal lifecycle, not scheduled duties"
type: feedback
created: 2026-06-07T19:46:06.063Z
---

When fixing goal management (issue #102), the pipeline should live in engine plumbing (engine reads goal state files) not as a scheduled duty. User explicitly corrected this — prefer engine-driven approach over cron-based duties for goal lifecycle.

**Why:** Duties are for periodic monitoring (CI failures, stale PRs). Goal lifecycle (decompose → build → QA → PR) is event-driven and triggered from the manage endpoint.

**How to apply:** When working on goal pipeline, look at how `manage/route.ts` dispatches the engine and what inputs the engine receives — not at `.kody/duties/`.
