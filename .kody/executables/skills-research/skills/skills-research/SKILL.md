---
name: skills-research
description: Research skills from skills.sh and recommend which Kody Dashboard executables should use them.
---

# Skills Research Skill

Use this skill when the `skills-research` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

Research new or updated skills on `https://www.skills.sh/` and report only
missing, non-duplicate skills that would improve Kody Dashboard.

## Sources

Start with:

- `https://www.skills.sh/`
- skills related to React, Next.js, shadcn, design systems, Playwright, QA,
  code review, CI, GitHub Actions, security, documentation, and research

Also read local context before recommending placement:

- `.kody/executables/*/profile.json`
- `.kody/executables/*/skills/*/SKILL.md`
- `docs/executables.md`
- `docs/duties.md`

## Evaluation

First inventory existing skills from `.kody/executables/*/skills/*/SKILL.md`
and `.kody/executables/*/profile.json`.

Then remove:

- skills already installed in the right executable
- skills that overlap an existing skill without adding a clear new capability
- broad “nice to have” skills with no immediate executable placement
- skills that should be local repo knowledge instead of external guidance

For each remaining gap, record:

- skill name and URL
- what it helps with
- which executable should use it
- why it belongs there
- risk or review note
- install priority: high, medium, low

Do not recommend a skill just because it exists. Prefer small delta reports
over long wishlists. Recommend only skills that improve real dashboard work:

- UI building
- UI review
- Next.js correctness
- QA browsing and Playwright tests
- CI repair
- security review
- documentation quality
- issue research and planning

## Placement Rules

- Add build/design skills to `feature` and sometimes `plan`.
- Add UI audit skills to `ui-review` and sometimes `review`.
- Add browser/testing skills to `qa-engineer` and `ui-review`.
- Add CI skills to `fix-ci` and CI-related duties.
- Add security skills to `review` or a security executable.
- Create a new executable only when the skill is itself a runnable action.

## Report

Write `.kody/reports/skills-research.md` on the `kody-state` branch with this
shape:

```md
---
generatedAt: "<now ISO>"
dutySlug: skills-research
reviewStatus: action-needed
reviewArea: engineering-capability
findings:
  - id: missing-vitest-skill
    severity: medium
    title: Add Vitest skill to test-writing executables
    linkedUrl: https://www.skills.sh/antfu/skills/vitest
---

# Skills Research

_Cadence: weekly. Source: skills.sh._

## Summary

<short summary of what changed since the current repo inventory>

## Existing Coverage

- <skills already covering the main areas>

## New Recommendations

| Skill | Priority | Add to | Why |
| --- | --- | --- | --- |
| `<name>` | high | `feature`, `ui-review` | <reason> |

If there are no strong new gaps, write `None.` under New Recommendations.

## Skipped As Duplicates

- `<name>` overlaps `<existing-skill>`; skipped.

## Notes

- <risks, duplicates, or skills to skip>
```

If the report content is byte-identical to the existing report, skip the write.

## Allowed Commands

- Playwright MCP for browsing `skills.sh`
- `curl` or `gh api` through Bash when needed
- `gh api -X PUT` only for `.kody/reports/skills-research.md` on branch `kody-state`

## Restrictions

- Do not install skills.
- Do not edit executables, duties, docs, or source files.
- Do not open issues or PRs.
- Do not recommend skills without a clear executable placement.
- Do not list already-installed skills as recommendations.
- Do not list duplicate skills unless the report explains why they were skipped.
- Only write `.kody/reports/skills-research.md`.
