---
name: "create_kody_duty must verify folder shape"
description: "create_kody_duty must produce .kody/duties/<slug>/profile.json plus duty.md; verify metadata/body split with read_duty after every create"
type: feedback
created: 2026-06-11T12:38:30.835Z
updated: 2026-06-12T00:00:00.000Z
---

When using `create_kody_duty`, the duty must be created as a folder:

- `.kody/duties/<slug>/profile.json`
- `.kody/duties/<slug>/duty.md`

Metadata such as `action`, `executable`, `every`, `staff`, `stage`, `mentions`, `readsFrom`, and `writesTo` belongs in `profile.json`. The `duty.md` body should contain readable purpose, output, allowed commands, and restrictions, with no YAML frontmatter.

**Why:** Duties are no longer single markdown files. The old `.kody/duties/<slug>.md` frontmatter contract is legacy and should not be recreated.

**How to apply:** After every `create_kody_duty` call, immediately call `read_duty` and verify the expected schedule, staff, disabled state, action, executable, and body. If the metadata/body split is wrong, fix the duty folder rather than creating a legacy markdown file.
