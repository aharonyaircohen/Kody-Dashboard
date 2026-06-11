# Kody memory index

One line per memory. The chat agent maintains this file — do not edit by hand.
Each entry: `- [Title](id.md) — one-line hook (type: <type>)`.
- [create_kody_duty frontmatter is unreliable](create-kody-duty-frontmatter-unreliable.md) — create_kody_duty tool may not write the every/staff/disabled frontmatter from its parameters; verify with read_duty after every create, fix the file directly if missing (type: feedback)
- [Goal pipeline = engine, not duty](goal-pipeline-engine-not-duty.md) — Use engine plumbing for goal lifecycle, not scheduled duties (type: feedback)
- [Kody dispatch uses bare @kody](kody-dispatch-uses-bare-kody.md) — Use bare @kody comment to trigger pipeline, not @kody run (type: feedback)
- [Voice wake-lock is a recurring issue](voice-wake-lock-recurring.md) — User has flagged \"voice screen dims on mobile\" multiple times; prior fixes haven't stuck — verify any new fix actually holds on Android Chrome before closing. (type: project)
