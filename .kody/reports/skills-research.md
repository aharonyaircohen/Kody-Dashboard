---
generatedAt: "2026-06-11T16:23:58Z"
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

After checking the current executable skills, most useful skills are already covered. The only clear missing recommendation is still `vitest`.

## Existing Coverage

- UI build/design is already covered by `design-system`, `frontend-design`, `shadcn`, `vercel-react-best-practices`, and `next-best-practices` on `feature` / `plan`.
- UI review is already covered by `design-system`, `web-design-guidelines`, and `webapp-testing` on `ui-review` / `review`.
- Browser QA is already covered by `webapp-testing` on `qa-engineer` / `ui-review`.
- CI repair is already covered by `github-actions-docs` on `fix-ci` / `dev-ci-health`.
- Design extraction already has a separate `extract-design-system` executable.

## New Recommendations

| Skill | Priority | Add to | Why |
| --- | --- | --- | --- |
| `vitest` | high | `bug`, `feature`, `reproduce` | This repo uses Vitest, and these executables write or repair tests. Source: https://www.skills.sh/antfu/skills/vitest |

## Skipped As Duplicates

- `e2e-testing-patterns` overlaps `webapp-testing`; skip until QA needs deeper test-suite structure.
- `code-review-excellence` overlaps existing `code-review`; skip unless review quality is still weak.
- `nextjs-app-router-patterns` overlaps `next-best-practices`; skip unless advanced App Router work becomes a common failure mode.
- `frontend-design`, `shadcn`, `vercel-react-best-practices`, `next-best-practices`, `web-design-guidelines`, `webapp-testing`, and `github-actions-docs` are already installed where they belong.

## Notes

- Future runs should report deltas only: missing skills, duplicates skipped, and changed recommendations.
- Do not turn every useful skill into an install request.