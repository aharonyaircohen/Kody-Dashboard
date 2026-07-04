---
generatedAt: "2026-07-04T20:38:00Z"
capabilitySlug: skills-research
reviewStatus: action-needed
reviewArea: engineering-capability
findings:
  - id: missing-shadcn-skill
    severity: medium
    title: Add shadcn (shadcn/ui) to design-review and feature implementations
    linkedUrl: https://www.skills.sh/shadcn/ui/shadcn
  - id: missing-frontend-design-anthropics
    severity: medium
    title: Add frontend-design (anthropics/skills) to design-review as a second lens
    linkedUrl: https://www.skills.sh/anthropics/skills/frontend-design
  - id: missing-vercel-composition-patterns
    severity: medium
    title: Add vercel-composition-patterns to architecture-audit (CTO)
    linkedUrl: https://www.skills.sh/vercel-labs/agent-skills/vercel-composition-patterns
  - id: missing-vercel-react-best-practices
    severity: medium
    title: Add vercel-react-best-practices to architecture-audit (CTO) for performance
    linkedUrl: https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
  - id: missing-web-design-guidelines
    severity: medium
    title: Add web-design-guidelines to the design-review capability
    linkedUrl: https://www.skills.sh/vercel-labs/agent-skills/web-design-guidelines
  - id: missing-playwright-best-practices
    severity: medium
    title: Add playwright-best-practices to qa / qa-sweep
    linkedUrl: https://www.skills.sh/currents-dev/playwright-best-practices-skill/playwright-best-practices
  - id: missing-next-best-practices
    severity: medium
    title: Add next-best-practices to architecture-audit (CTO)
    linkedUrl: https://www.skills.sh/vercel-labs/next-skills/next-best-practices
  - id: missing-improve-codebase-architecture
    severity: medium
    title: Add improve-codebase-architecture to architecture-audit (CTO)
    linkedUrl: https://www.skills.sh/mattpocock/skills/improve-codebase-architecture
  - id: missing-code-review
    severity: medium
    title: Add code-review to qa-sweep (parallel Standards + Spec diff review)
    linkedUrl: https://www.skills.sh/mattpocock/skills/code-review
  - id: missing-extract-design-system
    severity: low
    title: Add extract-design-system to design-review (no design system yet)
    linkedUrl: https://www.skills.sh/arvindrk/extract-design-system/extract-design-system
  - id: missing-next-cache-components
    severity: low
    title: Add next-cache-components to architecture-audit (CTO) for cross-instance cache work
    linkedUrl: https://www.skills.sh/vercel-labs/next-skills/next-cache-components
---

# Skills Research

_Cadence: weekly. Source: skills.sh._

## Summary

Kody Dashboard already has broad coverage on the core surfaces the engine cares
about: design coherence (`.kody/capabilities/design-review`, ux-designer),
Playwright QA (`.kody/capabilities/qa` + `qa-sweep`, qa agent), security
(`.kody/capabilities/security-audit`), architecture
(`.kody/capabilities/architecture-audit`, cto agent), test coverage
(`.kody/capabilities/coverage-floor`), flaky tests
(`.kody/capabilities/flaky-test-quarantine`), docs coverage/drift
(`.kody/capabilities/docs-code`, `docs-readme`), dead-code
(`.kody/capabilities/dead-code-sweep`), and dependency updates
(`.kody/capabilities/dependency-bump`). The repo is Next.js App Router with
Tailwind + Radix (shadcn-style components), Vitest for units, Playwright for
e2e, Vercel AI SDK for chat, and Vercel for production deploys. CLAUDE.md notes
one open follow-up — swap the in-memory GitHub cache for Vercel's Data Cache
(`fetch` + `revalidateTag`).

The gap is **opinionated, external rubrics for the existing reviewers**
(design, qa, cto) and the **specific libraries the dashboard already ships**
(shadcn, Vercel AI SDK, Vercel deploy). The capabilities today name a scope
(spacing/typography/etc. for design; selectors/fixtures/parallelism for qa;
App Router/RSC boundaries for architecture) but their bodies delegate the
method to a delegating runbook without an external reference. That's where
the high-leverage skills sit.

**What changed since 2026-07-03:** four genuinely new placements — `shadcn/ui`
fits `design-review` directly (CLAUDE.md says the dashboard uses
shadcn-style components); `frontend-design` (anthropics/skills, currently #2
on the skills.sh leaderboard) is a complementary lens to `web-design-guidelines`
for `design-review`; `vercel-composition-patterns` fits `architecture-audit`
(CTO) for component-API architecture; and `vercel-react-best-practices` fits
`architecture-audit` (CTO) for the 69 prioritized React/Next.js performance
rules the CTO sweep currently has no rubric for. The seven previous
recommendations remain valid — no churn.

## Existing Coverage

- **UI coherence + design-system drift:** `design-review` (ux-designer)
- **Playwright e2e + change verification:** `qa` (qa), `qa-sweep` (qa)
- **CTO architecture sweep (boundaries, dependency direction, dead abstractions):** `architecture-audit` (cto)
- **OWASP / STRIDE / dep CVE posture:** `security-audit`
- **Test coverage floor:** `coverage-floor`
- **Flaky test quarantine:** `flaky-test-quarantine`
- **Dead code:** `dead-code-sweep`
- **Dependency bump:** `dependency-bump`
- **Type debt:** `type-debt`
- **Docs coverage / drift:** `docs-code`, `docs-readme`
- **Job orchestration health:** `system-audit` (coo)
- **PR health:** `pr-health-triage` (cto)
- **Capability review:** `capability-review` (coo)

## New Recommendations

| Skill | Priority | Add to | Why |
| --- | --- | --- | --- |
| `shadcn` (shadcn/ui) | high | `design-review` (ux-designer), `feature` implementations | CLAUDE.md explicitly notes "Next.js App Router with Tailwind + Radix (shadcn-style components)." The repo's primitives live in `src/dashboard/lib/components/` and reuse Radix wrappers — exactly what `shadcn/ui` covers (component usage, customization, Tailwind integration, theming). The skill is the rubric for "use the shadcn primitive instead of a one-off Radix wrapper" findings, which is the most common drift in this codebase. Pairs 1:1 with the existing design-review scope. |
| `frontend-design` (anthropics/skills) | medium | `design-review` (ux-designer) | Currently #2 on the skills.sh leaderboard; describes itself as "Comprehensive frontend design patterns and visual polish guidance." Distinct from `web-design-guidelines`: that one is Vercel's opinionated rule set (spacing scale, type ramp, contrast, motion); this one is Anthropic's broader visual-polish rubric (hierarchy, density, color, motion). Two complementary lenses for the same review pass — one for rule compliance, one for taste. The dashboard's recent commits lean hard on visual polish (`Compact dashboard home health strip`, `Refine dashboard home health row`, `Simplify dashboard home header`), so a taste rubric is timely. |
| `vercel-composition-patterns` (vercel-labs/agent-skills) | medium | `architecture-audit` (cto) | Covers compound components, render props, context patterns for "scalable component APIs that don't accumulate boolean prop sprawl." The current audit body enumerates "module boundaries / single responsibility" but says nothing about component API design — the place where dashboard components are most likely to grow props over time. Complements `improve-codebase-architecture` (that one = module-level shape; this one = component-level API). |
| `vercel-react-best-practices` (vercel-labs/agent-skills) | medium | `architecture-audit` (cto) | 69 prioritized React/Next.js performance rules across 8 categories (waterfalls, bundle size, re-renders, advanced patterns). Kody Dashboard is App Router through and through; the existing `next-best-practices` covers correctness (file conventions, RSC boundaries, async APIs), this one covers **performance** (where to memo, what not to barrell-import, async-parallel opportunities). The CTO sweep would otherwise miss the kind of regression that only shows up in production traces. |
| `web-design-guidelines` (vercel-labs/agent-skills) | high | `design-review` (ux-designer) | The capability body lists the exact rubric this skill encodes — spacing scale, type ramp, color roles, interaction, a11y/WCAG AA — but lacks the external reference for the delegated analysis to score against. Pairs 1:1 with the existing sweep scope; without it, reviewers drift into subjective feedback. |
| `playwright-best-practices` (currents-dev) | high | `qa`, `qa-sweep` (qa) | Kody Dashboard already runs Playwright (`@playwright/test` 1.59, `pnpm test:e2e`); the qa capability delegates to a browser-side `qa-engineer`. The skill covers resilient selectors, fixtures, parallelism, CI integration — exactly the failure modes that produce flaky tests on this kind of dynamic, GitHub-driven UI. Drops the rate of re-runs the in-flight changelog gate would otherwise have to chase. |
| `next-best-practices` (vercel-labs/next-skills) | high | `architecture-audit` (cto) | Kody Dashboard is App Router through and through; CLAUDE.md describes the App Router file layout, route handlers, and metadata wiring. The current CTO sweep covers boundaries and dependency direction but says nothing about RSC/client-component placement, async route APIs, metadata, error boundaries, or route-segment config. Without this skill the audit misses Next.js-specific correctness issues that show up as prod hot-fixes. |
| `improve-codebase-architecture` (mattpocock/skills) | medium | `architecture-audit` (cto) | The audit body already enumerates "module boundaries / single responsibility," "premature / dead abstractions," "duplication" — i.e. exactly the surface this skill covers, with a concrete method (organic exploration, Ousterhout's "deep modules" — small interfaces hiding large implementations, multiple radically different refactor designs via sub-agents, GitHub-issue RFCs for each). The current capability lacks that method. Complements `next-best-practices` (this = module quality; that = framework correctness). |
| `code-review` (mattpocock/skills) | medium | `qa-sweep` (qa) | `qa-sweep` already walks the Unreleased changelog and dispatches one tracking issue per bullet. Each bullet is backed by a merged PR — that's the fixed point the skill needs — and the originating issue/PR body is the Spec axis. The skill runs Standards (does this match the repo's documented conventions?) and Spec (does this actually deliver the issue?) as **parallel sub-agents**, then aggregates. This is the review-shaped piece `qa-sweep` currently delegates without an external rubric. Pairs with `playwright-best-practices`: that one scores the running app, this one scores the diff. |
| `extract-design-system` (arvindrk) | medium | `design-review` (ux-designer) | CLAUDE.md says "if the repo has no design system at all, the first report should propose one" and `design-review/capability.md` already says this verbatim. The capability lacks the concrete method for that first pass. extract-design-system provides a deterministic token/component extraction flow rather than a vibes-only audit. |
| `next-cache-components` (vercel-labs/next-skills) | medium | `architecture-audit` (cto) | CLAUDE.md calls out the open follow-up: replace the in-memory cache with Vercel Data Cache (`fetch` + `revalidateTag`) so other instances stop serving stale data until TTL. PPR / `use cache` / `cacheLife` / `cacheTag` are the API the eventual implementation will touch. CTO reviews the live PR; the skill is the rubric for whether the change respects the new caching model end-to-end. |

## Skipped As Duplicates

- `find-skills` (vercel-labs/skills) — discovery helper, not a content rubric; no placement.
- `agent-browser` (vercel-labs/agent-browser) — agent-browser is for coding agents that *drive* a browser, not for Playwright-based QA. `playwright-best-practices` is the right fit; this overlaps without adding a new capability.
- `vercel-deploy` / `deploy-to-vercel` (vercel-labs/agent-skills) — the dashboard deploys via `vercel --prod` from CLAUDE.md, but no `deploy` capability exists in `.kody/capabilities/`, and the project instructions (Vercel CLI under "Deployment") already cover the local flow. Proposing a new capability just for this would over-scope.
- `ai-sdk` (vercel/ai) — the chat flow uses the AI SDK, but the implementation is owned by the engine (`kody2/src/chat/loop.ts`) and the dashboard's three backends are already documented in CLAUDE.md. No current capability owns AI SDK pattern review; skip rather than invent one.
- `tdd` (mattpocock/skills), `test-driven-development` (obra/superpowers), `verification-before-completion` (obra/superpowers) — these are process skills (loop discipline), not content rubrics. The current capabilities already enforce cadence via the engine's tick/stall machinery; bolting process skills on top would double-discipline.
- `webapp-testing` (anthropics/skills) — broad "testing React apps" rubric. `playwright-best-practices` is more specific and a better fit for the dashboard's e2e path; `webapp-testing` would be the second opinion only if the dashboard grew a real unit/integration test culture beyond today's Vitest baseline.
- `polish`, `critique`, `bolder`, `delight`, `distill`, `quieter` (pbakaus/impeccable) — taste-and-tone variants. The dashboard's recent commits lean on `polish`-style work, but each is a one-shot aesthetic verb; recommending six near-duplicates adds noise. If we add one later, `polish` is the closest fit; until then, `web-design-guidelines` + `frontend-design` cover the ground.

## Notes

- **shadcn is the highest-priority new addition.** The previous report's design-review recommendations were generic; the dashboard's component library is concretely shadcn-style, and the rubric maps 1:1 to drift we're already seeing (Radix wrappers around patterns that have a canonical shadcn primitive).
- **frontend-design + web-design-guidelines are intentionally complementary.** The Anthropic skill leans visual/taste, the Vercel skill leans rule/structure. Two reviewers running both against the same page will catch more than either alone.
- **`vercel-composition-patterns` is NOT a duplicate of `improve-codebase-architecture`.** That one is module-level (Ousterhout's deep modules, layering); this one is component-API-level (compound components, render-props, boolean-prop sprawl). Different scales, both useful.
- **No new security skills recommended.** The audits page shows `find-skills` and a long Azure tail; nothing applicable to the dashboard's PAT / OAuth / VAPID / webhook / vault surface. The `security-audit` capability already owns OWASP/STRIDE/CVE posture, and CLAUDE.md carries the rate-limit and webhook-auth rules that a generic skill wouldn't replace.
- **Process skills (TDD, verification-before-completion) were considered and skipped** — they belong to the agent identity, not the capability body.
