---
generatedAt: "2026-07-03T21:48:30Z"
dutySlug: skills-research
reviewStatus: action-needed
reviewArea: engineering-capability
findings:
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
e2e. CLAUDE.md notes one open follow-up — swap the in-memory GitHub cache for
Vercel's Data Cache (`fetch` + `revalidateTag`).

The gap is **opinionated, external rubrics for the existing reviewers**
(design, qa, cto). The capabilities today name a scope (spacing/typography/etc.
for design; selectors/fixtures/parallelism for qa; App Router/RSC boundaries
for architecture) but their bodies delegate the method to a delegating runbook
without an external reference. That's where the high-leverage skills sit.

**What changed since 2026-06-30:** one genuinely new placement — `mattpocock/skills/code-review`
fits `qa-sweep` (qa) directly. The skill runs a two-axis diff review
(Standards + Spec) with parallel sub-agents that don't pollute each other's
context, then aggregates findings. Kody's `qa-sweep` already walks the
Unreleased changelog and dispatches a tracking issue per bullet; the merge-base
SHA behind each bullet maps cleanly onto the skill's "fixed point" input, and
the originating issue/PR body maps onto the Spec axis. Five previous
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
| `web-design-guidelines` (vercel-labs/agent-skills) | high | `design-review` (ux-designer) | The capability body lists the exact rubric this skill encodes — spacing scale, type ramp, color roles, interaction, a11y/WCAG AA — but lacks the external reference for the delegated analysis to score against. Pairs 1:1 with the existing sweep scope; without it, reviewers drift into subjective feedback. |
| `playwright-best-practices` (currents-dev) | high | `qa`, `qa-sweep` (qa) | Kody Dashboard already runs Playwright (`@playwright/test` 1.59, `pnpm test:e2e`); the qa capability delegates to a browser-side `qa-engineer`. The skill covers resilient selectors, fixtures, parallelism, CI integration — exactly the failure modes that produce flaky tests on this kind of dynamic, GitHub-driven UI. Drops the rate of re-runs the in-flight changelog gate would otherwise have to chase. |
| `next-best-practices` (vercel-labs/next-skills) | high | `architecture-audit` (cto) | Kody Dashboard is App Router through and through; CLAUDE.md describes the App Router file layout, route handlers, and metadata wiring. The current CTO sweep covers boundaries and dependency direction but says nothing about RSC/client-component placement, async route APIs, metadata, error boundaries, or route-segment config. Without this skill the audit misses Next.js-specific correctness issues that show up as prod hot-fixes. |
| `improve-codebase-architecture` (mattpocock/skills) | medium | `architecture-audit` (cto) | The audit body already enumerates "module boundaries / single responsibility," "premature / dead abstractions," "duplication" — i.e. exactly the surface this skill covers, with a concrete method (organic exploration, Ousterhout's "deep modules" — small interfaces hiding large implementations, multiple radically different refactor designs via sub-agents, GitHub-issue RFCs for each). The current capability lacks that method. Complements `next-best-practices` (this = module quality; that = framework correctness). |
| `code-review` (mattpocock/skills) | medium | `qa-sweep` (qa) | `qa-sweep` already walks the Unreleased changelog and dispatches one tracking issue per bullet. Each bullet is backed by a merged PR — that's the fixed point the skill needs — and the originating issue/PR body is the Spec axis. The skill runs Standards (does this match the repo's documented conventions?) and Spec (does this actually deliver the issue?) as **parallel sub-agents**, then aggregates. This is the review-shaped piece `qa-sweep` currently delegates without an external rubric. Pairs with `playwright-best-practices`: that one scores the running app, this one scores the diff. |
| `extract-design-system` (arvindrk) | medium | `design-review` (ux-designer) | CLAUDE.md says "if the repo has no design system at all, the first report should propose one" and `design-review/capability.md` already says this verbatim. The capability lacks the concrete method for that first pass. extract-design-system provides a deterministic token/component extraction flow rather than a vibes-only audit. |
| `next-cache-components` (vercel-labs/next-skills) | medium | `architecture-audit` (cto) | CLAUDE.md calls out the open follow-up: replace the in-memory cache with Vercel Data Cache (`fetch` + `revalidateTag`) so other instances stop serving stale data until TTL. PPR / `use cache` / `cacheLife` / `cacheTag` are the API the eventual implementation will touch. CTO reviews the live PR; the skill is the rubric for whether the change respects the new caching model end-to-end. |

## Skipped As Duplicates

- `frontend-design` (anthropics) — broad design guidance that overlaps both `design-review` scope and `web-design-guidelines`. Recommending only the sharper, Vercel-authored rubric keeps the surface small.
- `vercel-react-best-practices` — no Kody agent currently owns UI build work (executables inventory has ceo/coo/cto/qa/tech-writer/ux-designer); "add to feature/plan" from the placement rules does not map onto an existing capability in this repo.
- `vercel-composition-patterns` — useful but no clear placement; CTO audit is architecture-level, design-review is coherence-level.
- `shadcn` (shadcn/ui) — repo already imports shadcn-style components (Radix + Tailwind, `src/dashboard/lib/utils/ui.ts` mentions "installing other shadcn components"); no review gap surfaced.
- `ui-ux-pro-max`, `design-taste-frontend`, `canvas-design` — all overlap `web-design-guidelines` without filling a distinct gap; the existing recommendation covers the rubric.
- `tdd` / `test-driven-development` (obra), `webapp-testing` (anthropics), `playwright-cli` (microsoft), `verification-before-completion` (obra) — all overlap `coverage-floor` / `qa` / `qa-sweep` without filling a distinct gap; `coverage-floor` already enforces coverage discipline, and `playwright-cli` describes the same browser automation the QA MCP server already exposes.
- `systematic-debugging`, `writing-plans`, `executing-plans`, `dispatching-parallel-agents`, `subagent-driven-development`, `requesting-code-review`, `using-git-worktrees`, `finishing-a-development-branch` (obra/superpowers) — no Kody executable matches: there is no build/plan/feature/orchestration agent. `redispatch` is fully scripted and `pr-health-triage` is fully scripted; neither has a method gap.
- `polish` / `critique` / `bolder` / `delight` / `distill` / `quieter` (impeccable) — taste micro-skills; no placement mapped to an existing ux-designer job slot.
- `tailwind-design-system` — repo already uses Tailwind 4 with merge/animate/typography pre-configured; not a gap.
- `typescript-advanced-types` — overlaps `type-debt`.
- `ai-sdk` (vercel/ai) — `@ai-sdk/anthropic` and `@ai-sdk/openai-compatible` already in use; no rubric gap.
- `deploy-to-vercel` — overlaps `publish-release`.
- `turborepo` — not a Turborepo monorepo.
- `sleek-design-mobile-apps`, `high-end-visual-design`, `emil-design-eng` — aesthetic-direction skills; the dashboard's design system, when it exists, will not be mobile-first or luxury-editorial.
- `lark-approval`, `azure-*`, `microsoft-foundry`, `agentspace`, `to-prd`, `to-issues`, `caveman`, `video-edit`, `kling-3-0`, `remotion-best-practices`, `remotion-render`, `viral-short-form`, `image-inpainting`, `image-outpainting`, `nano-banana-edit`, `elevenlabs-music-generation`, `happyhorse-1-0`, `ace-step`, `wan-2-7`, `controlnet-pose`, `ralph-*` — out of scope for Kody Dashboard's stack (Feishu, Azure, media generation, video gen).
- `grill-me` / `grill-with-docs` / `grilling` (mattpocock) — interrogative prompting patterns; no Kody capability currently needs an interrogation rubric.
- `handoff` (mattpocock) — agent-to-agent handoff; no orchestration agent in this repo.
- `domain-modeling` (mattpocock) — requires `CONTEXT.md` + `docs/adr/` file conventions. Kody Dashboard uses `.kody/context/*.md` + `.kody/memory/*.md` instead. The skill is well-scoped but its file-shape contract would need a structural port before it adds anything; not a near-term recommendation.
- `brainstorming`, `browser-use`, `agent-browser` — agent workflow patterns with no executable placement.
- `find-skills`, `skill-creator` — meta skills for the skills.sh ecosystem itself; no value to a Kody run.

## Notes

- The recommendations are deliberately **review-side** (design-review / qa / cto). Kody Dashboard has no "feature" or "plan" agent in the current inventory, so build-time skills (`vercel-react-best-practices`, `vercel-composition-patterns`, `tdd`, superpowers workflow skills) have no executable placement and were skipped to keep the delta small. Revisit if a `feature` executable is added.
- Seven recommendations is the floor of what's clearly missing; nothing else on the leaderboard fills a gap an existing capability already covers.
- `improve-codebase-architecture` and `next-best-practices` are *both* recommended for `architecture-audit` because the audit's own scope is broad: framework correctness (`next-best-practices`) and module quality (`improve-codebase-architecture`) are different rubrics the same reviewer needs.
- `playwright-best-practices` and `code-review` are *both* recommended for `qa-sweep` because the sweep has two distinct review surfaces: the running app (browser, fixtures, selectors) and the diff (Standards, Spec). Different rubrics, same reviewer.
- **Risk:** `web-design-guidelines` and `next-best-practices` are opinionated. Recommendation: treat them as a **rubric + checklist**, not as the source of truth — keep the existing capability bodies as the contract, and have the delegated run cite the skill when scoring a finding. Risk of "drift into boilerplate" rather than into site-specific issues is real; mitigate by requiring file:line citations in every report.
- **Risk:** `playwright-best-practices` may push the qa engineer toward writing new selectors that fight the existing test suite. Prefer selective fixture reuse over adopting the full pattern wholesale.
- **Risk:** `improve-codebase-architecture` recommends running sub-agents and producing GitHub-issue RFCs. The current architecture-audit capability body already delegates via a tracking issue; the skill's RFC format maps cleanly onto that. Watch that RFC volume stays bounded (one RFC per finding, not one per file).
- **Risk:** `code-review` requires an issue tracker and a fixed-point SHA. `qa-sweep` already provides both (the originating changelog PR = the SHA; the tracking issue = the issuer of the verdict), so the integration is clean — but the delegated run must avoid falling back to free-text "looks good" verdicts; require the skill's aggregated two-axis output as the entry shape for the `QA [PASS|CONCERNS|FAIL]` verdict.
- **Risk:** `extract-design-system` is best used once, when the design system is greenfield. Once the design system exists, retire it; the recurring `design-review` sweep takes over.
- All seven skill names map cleanly to existing `.kody/capabilities/<slug>/` folders; no new executable required.
