# Implementation Planning

Use this skill to produce a deep implementation plan without editing code.

## Research workflow

1. Read the issue, comments, conventions, and prior art.
2. If a previous plan comment exists, use delta mode:
   - preserve unchanged content,
   - mark changed bullets `(updated)`,
   - mark new bullets `(new)`,
   - mark removed bullets `(removed - <reason>)`,
   - fail when nothing material changed.
3. Fetch issue URLs with Playwright MCP before planning. Treat linked demos,
   specs, and mocks as part of the specification.
4. Meet the research floor:
   - read every file the plan will change,
   - read matching tests when they exist,
   - read sibling modules that already implement the same pattern,
   - read prior-art diffs when present.
5. Use `plan-scout` subagents in parallel for distinct investigation areas
   when the issue is not trivially single-file.
6. Verify every named API, hook, import, config key, or framework primitive
   against files or packages actually read. Mark unresolved symbols as
   `UNVERIFIED` and treat them as blockers.

## Required plan sections

The plan in `PR_SUMMARY` must include these sections when applicable:

- `## Requirement coverage`
- `## Existing patterns found`
- `## Changes (per file)`
- `## Dependencies to install`
- `## Algorithms & pseudocode`
- `## How clarifying answers shape the plan`
- `## Why this will work`
- `## API surface verification`
- `## Initial data state -> transition -> steady state`
- `## Error paths & failure handling`
- `## Test plan`
- `## Ambiguities & assumptions`
- `## Verification checklist`

Omit only sections whose trigger condition is genuinely absent. Do not include
empty placeholders.

## Planning standards

- Cover every discrete ask from the issue and clarifying comments.
- Do not silently shrink scope. If the full ask is too large, fail with a split
  recommendation.
- For each changed file, include why it changes, current state, target state,
  exact edit anchors, dependency changes, and test impact.
- Include pseudocode for non-trivial algorithms.
- Include concrete failure paths for external calls and mutations.
- Keep the final plan within practical output limits; fail with a split when it
  would be too large to deliver intact.

## Boundaries

- Read only.
- Do not write code, modify files, run git, or run gh.
- Do not invent file paths, citations, or API names.
