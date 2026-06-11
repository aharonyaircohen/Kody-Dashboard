# UI Review

Use this skill to review UI-affecting PRs by reading the diff and browsing the
running preview.

## Workflow

1. Identify UI-affecting changes from the diff.
2. Navigate to the preview URL with Playwright MCP before other browsing.
3. If the preview is unreachable, continue with a diff-only review and mark the
   browser verification gap.
4. Plan 1-3 relevant routes per UI surface.
5. When UI behavior changed, write one Playwright spec under
   `.kody/ui-review/browse.spec.ts` and save screenshots under
   `.kody/ui-review/`.
6. Exercise relevant states:
   - happy path,
   - loading,
   - empty,
   - error,
   - mobile/narrow viewport,
   - keyboard navigation.
7. Inspect screenshots before writing the review.

## Verdict rules

- `FAIL` for clear visual regressions, broken flows, accessibility/correctness
  issues that block merge, or a claimed user-visible fix that still reproduces.
- `CONCERNS` for polish or edge-case gaps that should not block, and whenever a
  UI-affecting change could not be browser-verified.
- `PASS` only when the changed behavior was confirmed in the browser.

## Required output

Return raw markdown only, with this shape:

```markdown
## Verdict: PASS | CONCERNS | FAIL

_UI review by kody — browsed <preview-url>_

### Summary
<2-3 sentences>

### What I browsed
- `<route>` — <what was checked, with screenshot path>

### UI findings
- <route + screenshot finding, or "None.">

### Code findings
- <file:line finding, or "None.">

### Gaps
- <unverified areas, or "None.">

### Bottom line
<one sentence>
```

Do not wrap the review in `DONE`, `COMMIT_MSG`, or `PR_SUMMARY`.
