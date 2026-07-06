---
generatedAt: "2026-07-06T22:23:34Z"
capabilitySlug: skills-research
reviewStatus: action-needed
reviewArea: engineering-capability
findings:
  - id: missing-tailwind-design-system
    severity: medium
    title: Add tailwind-design-system (v4) to design-review
    linkedUrl: https://www.skills.sh/wshobson/agents/tailwind-design-system
  - id: missing-typescript-advanced-types
    severity: medium
    title: Add typescript-advanced-types to type-debt
    linkedUrl: https://www.skills.sh/wshobson/agents/typescript-advanced-types
---

# Skills Research

_Cadence: weekly. Source: skills.sh._

## Summary

This pass (2026-07-06, two days after the 2026-07-04 report) scanned the Next.js,
React, Design & UI, Testing, and Agent-workflows topics on skills.sh and the
leaderboard trending feed. The eleven recommendations from the previous report
remain valid — no churn. Two genuinely new placements surfaced this week:

- **`tailwind-design-system`** (wshobson/agents) — the dashboard's
  `package.json` pins `tailwindcss: ^4.1.18`, so the CSS-first `@theme`
  rubric this skill encodes is now applicable end-to-end (CLAUDE.md already
  notes "shadcn-style components"; this skill is the Tailwind-side companion
  to the already-recommended `shadcn` and `extract-design-system`).
- **`typescript-advanced-types`** (wshobson/agents) — the dormant
  `type-debt` capability has no content rubric for advanced TS patterns
  (discriminated unions, conditional/infer, type-safe API clients); this skill
  is the missing external reference.

Two other candidates that initially looked promising were rejected on inspection
— see "Skipped As Duplicates" for `design-an-interface`, `playwright-cli`,
`ui-ux-pro-max`, the `leonxlnx/taste-skill` family, and the rest of the
near-duplicate set.

## Existing Coverage

- **UI coherence + design-system drift:** `design-review` (ux-designer)
- **Playwright e2e + change verification:** `qa` (qa), `qa-sweep` (qa)
- **CTO architecture sweep (boundaries, dependency direction, dead abstractions):** `architecture-audit` (cto)
- **OWASP / STRIDE / dep CVE posture:** `security-audit`
- **Test coverage floor:** `coverage-floor`
- **Flaky test quarantine:** `flaky-test-quarantine`
- **Dead code:** `dead-code-sweep`
- **Dependency bump:** `dependency-bump`
- **Type debt:** `type-debt` (dormant — see new recommendation)
- **Docs coverage / drift:** `docs-code`, `docs-readme`
- **Job orchestration health:** `system-audit` (coo)
- **PR health:** `pr-health-triage` (cto)
- **Capability review:** `capability-review` (coo)
- **Eleven external rubrics already recommended** in `reports/skills-research.md`
  (2026-07-04): `shadcn`, `frontend-design`, `vercel-composition-patterns`,
  `vercel-react-best-practices`, `web-design-guidelines`, `playwright-best-practices`,
  `next-best-practices`, `improve-codebase-architecture`, `code-review`,
  `extract-design-system`, `next-cache-components`.

## New Recommendations

| Skill | Priority | Add to | Why |
| --- | --- | --- | --- |
| `tailwind-design-system` (wshobson/agents) | high | `design-review` (ux-designer) | `package.json` pins `tailwindcss: ^4.1.18`, so the v4 CSS-first rubric this skill encodes — `@theme` blocks, OKLCH color spaces, `@custom-variant` for dark mode, `@utility` directives, container queries, `color-mix()` for alpha, CVA-based variants — is directly applicable. CLAUDE.md already says the dashboard uses "Tailwind + Radix (shadcn-style components)"; this skill is the Tailwind-side companion to the already-recommended `shadcn` and `extract-design-system`. Pairs 1:1 with the design-review scope (token hierarchy, responsive patterns, a11y focus states) and gives the reviewer an external rubric to score the recent visual-polish commits against. |
| `typescript-advanced-types` (wshobson/agents) | medium | `type-debt` (kody) | The `type-debt` capability is dormant and currently has no content rubric beyond generic type coverage. The dashboard is TypeScript-strict end-to-end (CLAUDE.md notes `pnpm typecheck`), and the chat / API surface in `app/api/kody/` leans on advanced patterns (discriminated unions for chat-event types, type-safe API client patterns for GitHub webhooks, conditional/infer in event extractors). The skill's six advanced patterns — type-safe event emitters, API clients, builder patterns, deep readonly/partial, form validation, discriminated unions — map 1:1 to the kind of drift that produces `as any` escape hatches and is the right external reference for `type-debt` to score against. |

## Skipped As Duplicates

- `design-an-interface` (mattpocock/skills) — applies the same "Design It
  Twice" / Ousterhout framework as the already-recommended
  `improve-codebase-architecture`; both spawn parallel sub-agents to
  generate radically different designs. Recommending both adds a near-twin
  without a different capability placement.
- `playwright-cli` (microsoft/playwright-cli) — duplicate of
  `playwright-best-practices` from a placement standpoint, **and** the
  skills.sh security panel shows a Snyk FAIL. Even if the FAIL is benign,
  pairing a security-fail skill with the `qa` capability is the wrong
  signal — skip.
- `ui-ux-pro-max` (nextlevelbuilder) — describes itself as "comprehensive
  design intelligence across 10 technology stacks," but its React /
  Next.js / Tailwind / shadcn coverage is a broad, shallow aggregate of
  what `shadcn` + `web-design-guidelines` + `vercel-composition-patterns`
  already encode. Recommending it would dilute the focused rubrics the
  dashboard's reviewer should use.
- `design-taste-frontend`, `high-end-visual-design`,
  `redesign-existing-projects`, `minimalist-ui`, `brandkit`
  (leonxlnx/taste-skill) — taste-level skills, same family the previous
  report explicitly skipped when evaluating the `pbakaus/impeccable`
  verbs (`polish`, `critique`, `bolder`, `delight`, `distill`, `quieter`).
  The reasoning holds: the `frontend-design` (Anthropic) +
  `web-design-guidelines` (Vercel) pair already covers the taste-vs-rule
  split the design-review sweep needs. Five more taste verbs is noise.
- `turborepo` (vercel/turborepo) — the dashboard is not a monorepo
  (`pnpm dev` is the single-app workflow). No capability owns monorepo
  correctness; skip.
- `grill-me`, `grill-with-docs`, `wayfinder`, `design-an-interface`
  (mattpocock/skills) — process skills (interview / planning technique).
  Per the previous report's reasoning, the agent identities already carry
  loop discipline; bolting interview skills on top would double-discipline.
- `webapp-testing` (anthropics/skills) — already explicitly considered and
  skipped in the 2026-07-04 report as a broad "testing React apps" rubric
  that duplicates `playwright-best-practices` without adding a unit/integration
  placement the dashboard lacks today.
- `lark-*` (open.feishu.cn, larksuite/cli) — Lark / Feishu is a Chinese
  platform; the dashboard is GitHub-native. No `lark` capability exists,
  and the `inbox-ping` capability's mentions / heartbeat path uses GitHub
  Issues. Skip.
- `sleek-design-mobile-apps` (sleekdotdesign) — native iOS / Android design
  guidance. The dashboard ships as a PWA on mobile but uses web components
  end-to-end (CLAUDE.md: "PWA shell: `public/manifest.json`,
  `public/sw.js`, `public/icon.svg`"). No native mobile design surface.
- `canvas-design` (anthropics/skills) — for canvas / Figma design
  creation. The dashboard's design system is code-based
  (`src/dashboard/lib/components/`), not a Figma canvas. Skip.
- `caveman`, `caveman-compress`, `hyperframes`, `media-use`, `ralph-*`
  — tone / video / autonomous-loop skills. No placement in the current
  capabilities; recommending them would be wishlist-style.

## Notes

- **`tailwind-design-system` is the highest-priority new addition this pass.**
  It's the only recommendation with a concrete `package.json` verification
  (`tailwindcss: ^4.1.18`), and it pairs with two already-recommended skills
  (`shadcn`, `extract-design-system`) without overlapping them.
- **`typescript-advanced-types` activates a dormant capability.** The
  `type-debt` capability is in `.kody/capabilities/` but currently lacks
  an external rubric; this skill fills that gap without forcing a new
  capability.
- **No new security skills recommended.** Confirmed again this pass: the
  PAT / OAuth / VAPID / webhook / vault surface remains the domain of the
  existing `security-audit` capability plus CLAUDE.md's rate-limit and
  webhook-auth rules; nothing on skills.sh covers those specifics.
- **Taste skills continue to be filtered out as near-duplicates.** The
  `leonxlnx/taste-skill` family is a fresh arrival on the trending feed
  but covers the same ground as the previously-skipped
  `pbakaus/impeccable` verbs — the `frontend-design` +
  `web-design-guidelines` pair already handles the taste-vs-rule split.
- **Process skills (`grill-me`, `grill-with-docs`, `wayfinder`,
  `design-an-interface`) continue to be filtered out** — they belong to
  the agent identity, not to a capability body.
