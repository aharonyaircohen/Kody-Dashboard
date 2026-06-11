---
name: "create_kody_duty frontmatter is unreliable"
description: "create_kody_duty tool may not write the every/staff/disabled frontmatter from its parameters; verify with read_duty after every create, fix the file directly if missing"
type: feedback
created: 2026-06-11T12:38:30.835Z
---

When using `create_kody_duty`, the frontmatter fields (every, staff, disabled, mentions) passed as tool parameters are not always written to the duty file. The tool may commit only the body, leaving `staff: null`, `schedule: null`, `disabled: false` in `read_duty` output. Always call `read_duty` immediately after `create_kody_duty` and verify the YAML frontmatter landed. If it didn't, fix the file directly (commit the missing `---` block with the right fields), don't assume a re-create will work.

**Why:** I drafted a duty with `every: 1d`, `staff: kody`, `disabled: true` in my preview; the committed file had no frontmatter, and `read_duty` showed `disabled: false` / `staff: null`. The duty was enabled but not scheduled, so it would only run on manual `run_duty`.

**How to apply:** After every `create_kody_duty` call, the next action is `read_duty` to verify schedule, staff, and disabled flags. Treat a missing frontmatter as a known bug, not user error. Never tell the user the duty is "live on the next 5-min cron" without having read back the file and confirmed `schedule` is set.
