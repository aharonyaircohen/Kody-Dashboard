---
name: design-review
description: Run a periodic design-health sweep for visual coherence, usability, and accessibility risks.
---

# Design Review Skill

Use this skill when the `design-review` executable runs from the matching duty.

Runtime state is owned by the engine. Do not ask the duty author to configure raw state keys.

## Method

## Jobs

Periodic **design-health sweep** of the product's UI — coherence and usability, not feature behavior. The job itself cannot run shell beyond `gh`, so it opens a tracking issue delegating the analysis to a Kody executable in CI and tracks the result.

Scope of the delegated sweep:

- **Layout & spacing** — inconsistent padding/margins, misalignment, cramped or unbalanced composition; values that don't sit on the spacing scale.
- **Typography** — unclear hierarchy, ad-hoc font sizes/weights/line-heights that bypass the type ramp, illegible body text.
- **Theme & color** — colors used outside the defined roles/tokens, dark/light-mode breakage, and **contrast** below WCAG AA.
- **Responsiveness** — layouts that break or overflow on mobile/tablet widths; non-responsive fixed sizing.
- **Accessibility** — missing focus states, keyboard traps, unlabeled controls (alt text / ARIA), and too-small hit targets.
- **Design-system drift** — one-off styles where a shared token/component already exists; the same UI pattern implemented inconsistently across screens. **If the repo has no design system at all, the first report should propose one** (spacing scale, type ramp, color roles, core primitives) rather than file scattered fixes.

**Per tick (one action max):**

1. Check whether an open tracking issue exists:
   `gh issue list --label "kody:design-review" --state open --json number,title,createdAt,body`
2. If an open issue exists AND was created in the last 48 hours, emit state with `cursor: awaiting-result` and exit (the sweep is in flight; don't double-trigger).
3. If an open issue exists older than 48 hours with no `/kody` activity, post a single nudge comment:
   ```
   gh issue comment <n> --body "Design review appears stalled. /kody chore: re-run the design-health analysis and post the report."
   ```
   Then exit.
4. Otherwise (no open issue), open one:
   ```
   gh issue create \
     --title "design: health sweep $(date -u +%Y-%m-%d)" \
     --label "kody:design-review" \
     --body "/kody chore: run a read-only design-health analysis of the UI and post a single report comment grouped by severity (BLOCK / WARN / NIT). Cover: layout & spacing, typography hierarchy, theme & color (including WCAG AA contrast), responsiveness at mobile/tablet widths, accessibility (focus, keyboard, labels, hit targets), and design-system drift. Cite real file:line for every finding and name the existing token/component each should follow. If the repo has no design system, propose one (spacing scale, type ramp, color roles, core primitives) instead of scattered fixes. Open a fix PR ONLY for a concrete, low-risk consistency fix (swap an ad-hoc value for an existing token, add a missing focus state); leave subjective or larger redesign suggestions as report bullets, not PRs."
   ```
   Stash `data.openIssue = <number>`.

## Allowed Commands

- `gh issue list`, `gh issue create`, `gh issue comment`, `gh issue view`

## Restrictions

- Never edit files. Never push. Never run build/test/lint tools directly — delegation via `/kody chore` only.
- Maximum **one** issue created or commented per tick.
- If `gh issue create --label kody:design-review` fails because the label doesn't exist, run `gh label create kody:design-review --description "Kody job: design review"` and retry the create. **Do not skip the label** — the next-tick "is sweep in flight?" check depends on it.
- Never close an issue from this job — let any fix PRs auto-close via `Closes #N`, and close report-only issues manually after review.
