# Skills Research

_Cadence: weekly. Source: skills.sh._

## Summary

Best current additions for Kody Dashboard are UI/design, Next.js/React, QA/browser testing, and CI skills. Most high-priority skills should be attached to existing executables, not made into new executables.

## Recommended Skills

| Skill | Priority | Add to | Why |
| --- | --- | --- | --- |
| `design-system` | high | `feature`, `plan`, `ui-review`, `review` | Local skill for Kody Dashboard theme, shadcn usage, layout rules, and product-specific UI standards. |
| `frontend-design` | high | `feature`, `plan` | Helps build polished production UI; keep scoped by our dashboard design rules. Source: https://www.skills.sh/anthropics/skills/frontend-design |
| `shadcn` | high | `feature`, `plan` | Useful for shadcn component search, composition, styling, and fixes. Review command behavior before broad use. Source: https://www.skills.sh/shadcn/ui/shadcn |
| `vercel-react-best-practices` | high | `feature`, `plan`, `review` | React/Next performance guidance from Vercel Engineering. Source: https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices |
| `next-best-practices` | high | `feature`, `plan`, `review` | Next.js App Router, RSC boundaries, route handlers, metadata, images/fonts, and bundling. Source: https://www.skills.sh/vercel-labs/next-skills/next-best-practices |
| `web-design-guidelines` | high | `ui-review`, `review` | Good for UI/UX/accessibility audits and concrete review findings. Source: https://www.skills.sh/vercel-labs/agent-skills/web-design-guidelines |
| `webapp-testing` | high | `qa-engineer`, `ui-review` | Playwright workflow for local app testing, screenshots, logs, and UI debugging. Source: https://www.skills.sh/anthropics/skills/webapp-testing |
| `github-actions-docs` | high | `fix-ci`, `dev-ci-health` | Grounds CI repair in GitHub Actions syntax, runners, artifacts, caching, secrets, OIDC, and workflow docs. Source: https://www.skills.sh/xixu-me/skills/github-actions-docs |
| `vitest` | medium | `feature`, `bug`, `reproduce`, `fix-ci` | Useful when adding or repairing unit tests in this repo. Source: https://www.skills.sh/antfu/skills/vitest |
| `e2e-testing-patterns` | medium | `qa-engineer`, `ui-review` | Deeper E2E testing guidance; overlaps with `webapp-testing`, so add only if QA needs more test-suite structure. Source: https://www.skills.sh/wshobson/agents/e2e-testing-patterns |
| `code-review-excellence` | medium | `review` | Could strengthen PR review quality, but may overlap with existing `code-review`. Source: https://www.skills.sh/wshobson/agents/code-review-excellence |
| `nextjs-app-router-patterns` | medium | `feature`, `plan`, `review` | Useful for advanced App Router/RSC patterns; overlaps with `next-best-practices`. Source: https://www.skills.sh/wshobson/agents/nextjs-app-router-patterns |
| `extract-design-system` | low | separate `extract-design-system` executable only | Good one-time action to extract tokens from a public site; not an always-on skill. Source: https://www.skills.sh/arvindrk/extract-design-system/extract-design-system |

## Current Placement Check

The working tree already wires many of the high-priority skills into the right executables:

- `feature`: `implementation-session`, `design-system`, `frontend-design`, `shadcn`, `vercel-react-best-practices`, `next-best-practices`
- `plan`: `implementation-planning`, `design-system`, `frontend-design`, `shadcn`, `vercel-react-best-practices`, `next-best-practices`
- `review`: `code-review`, `design-system`, `vercel-react-best-practices`, `next-best-practices`, `web-design-guidelines`
- `ui-review`: `ui-review`, `design-system`, `web-design-guidelines`, `webapp-testing`
- `qa-engineer`: `qa-session`, `webapp-testing`
- `fix-ci`: `ci-repair`, `github-actions-docs`
- `dev-ci-health`: `dev-ci-health`, `github-actions-docs`

## Notes

- Do not create separate executables for method/context skills like `frontend-design`, `shadcn`, or `next-best-practices`.
- Do create a separate executable only when the action itself is the product, like `extract-design-system`.
- Prefer repo-owned `design-system` as the anchor skill so external design skills follow Kody Dashboard's actual theme and UI rules.
- Before installing `shadcn`, inspect the skill body because it may include shell command behavior.