---
name: ceo-performance-review
description: Review every staff member by the duties they own and the evidence those duties produce.
---

# CEO Performance Review Skill

Use this skill when the `ceo-performance-review` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

## Job

A **weekly review of every staff member**, the way a company reviews its
employees. The unit is the **person** (`.kody/staff/<slug>.md`), not the
task — `duty-review` (COO) grades whether each _duty_ is well designed;
this grades whether each _employee_ is actually **delivering the
responsibilities they own**.

An employee's "work" is the set of duties whose profile names them
(`"staff": "<slug>"`). Their delivery quality is read from the **evidence those
duties leave behind**: state files advancing on cadence, reports/comments
that aren't stale or empty, output that's useful rather than churn or noise.

This duty cannot measure subjective taste or judge free-form prose quality —
it has no ground truth for "good." It measures the honest, observable thing:
**are this person's responsibilities getting done, on time, with real
output?** A staff member who owns no active duties is reported as _idle_, not
graded.

Purely diagnostic: it never edits, re-kicks, or relabels anyone's duties.
**Output is a report file, not an inbox comment** — it overwrites
`.kody/reports/ceo-performance-review.md` each week, which the dashboard
Reports page surfaces. Past weeks live in that file's git history.

## Tick procedure (all staff, one report write)

Cadence is the `"every": "7d"` duty profile value — the engine enforces it. Do **not**
add a prose "skip if within 7 days" guard (that duplicates the schedule and
has caused regressions). State is recorded only for the dashboard "next run"
readout and the week-over-week delta.

1. **Pin the repo.** `gh`'s default repo is not guaranteed here:

   ```
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   ```

   For A-Guy this resolves to `A-Guy-educ/A-Guy`, default branch `dev`.

2. **Enumerate staff.** List every `<slug>.md` in `.kody/staff/`:

   ```
   gh api "/repos/$REPO/contents/.kody/staff" -q '.[].name'
   ```

   Drop non-`.md` files. Each remaining slug is one employee.

3. **Map duties to employees.** List the duty folders and read each one's
   `profile.json.staff` value so you know who owns what:

   ```
   gh api "/repos/$REPO/contents/.kody/duties" -q '.[].name'
   ```

   For each `<duty>/profile.json`, read `staff` and `disabled`. Group
   duties by owner. A duty with `"disabled": true` is **owned but parked** —
   list it under the employee, but don't penalize the employee for its
   idleness (disabled is the operator's choice, not the employee's miss).

4. **Gather each employee's delivery evidence.** For every _active_ duty
   they own:
   - **State history:** `gh api "/repos/$REPO/commits?path=.kody/duties/<slug>.state.json&per_page=10"` when the engine exposes duty state history — is the duty advancing roughly on its cadence, or frozen?
   - **Output:** any tracking issue the duty posts to, or `.kody/reports/<slug>.md` — did it produce real findings this week, or is it stale/empty? Repeated byte-identical no-op comments count as **churn**, not delivery.

5. **Grade each employee** on three observable axes, each Low / Med / High:
   - **Delivery** — did their active duties actually run and produce output this week? (No active duties → _idle_, ungraded.)
   - **Consistency** — did state advance on roughly the promised cadence, or are runs missed / frozen?
   - **Signal** — is the output useful (real findings, advancing work) versus churn / empty no-ops / noise?
     Roll the three into a one-word **Grade**: `strong` / `steady` / `weak` /
     `idle`. When the signal is genuinely ambiguous, say so and grade
     `unclear` rather than guessing — an honest unknown beats a fabricated
     score.

6. **Build the report markdown.** Lead with an `# Kody Performance Review`
   H1, then a `_Cadence: weekly — delivery of owned responsibilities, not
subjective quality._` line (**no timestamp** — `lastRunISO` lives in
   state, not the body, so a no-change week produces a byte-identical
   report). Then:
   - A one-sentence headline at the highest level (e.g. "Three of six staff
     delivered this week; tech-writer and ux-designer produced no output.").
   - A scoring table, one row per employee:
     ```
     | Staff | Owned duties | Delivery | Consistency | Signal | Grade |
     |-------|-------------|----------|-------------|--------|-------|
     | qa    | 2 (1 active)| High     | Med         | High   | steady |
     ```
   - Below the table, at most one short line per employee that isn't
     `steady` or `strong`, naming the concrete miss and its effect
     (`- **qa-engineer — weak:** qa-sweep state frozen 9 days; no sweep ran. **Effect:** regressions ship unreviewed.`).
   - A closing delta versus `data.lastGrades` if present
     (`- Changes since last week: tech-writer steady→strong; coo strong→weak.`).

7. **Write the report** at the canonical path
   **`.kody/reports/ceo-performance-review.md`** via `gh api` (fetch the
   prior sha so the PUT overwrites in place):

   ```
   sha=$(gh api "/repos/$REPO/contents/.kody/reports/ceo-performance-review.md" -q .sha 2>/dev/null || true)
   gh api -X PUT "/repos/$REPO/contents/.kody/reports/ceo-performance-review.md" \
     -f message="chore(ceo-performance-review): refresh report" \
     -f content="$(printf '%s' "$REPORT_BODY" | base64)" \
     -f branch="<defaultBranch>" \
     ${sha:+-f sha="$sha"}
   ```

   `<defaultBranch>` is `dev` for A-Guy. **One PUT per tick** — never write
   more than once.

8. **Emit closing state** (schema below) as the very last thing in the reply.

## Allowed Commands

- `gh repo view` — pin the repo.
- `gh api` reads against `/repos/$REPO/contents/.kody/staff`,
  `/repos/$REPO/contents/.kody/duties`, individual duty bodies, their
  `.state.json` files, `.kody/reports/*`, and
  `/repos/$REPO/commits?path=...` for run history.
- `gh api -X PUT` against `.kody/reports/ceo-performance-review.md` **only** —
  to write the report. Permitted by the global duty-tick contract.

## Restrictions

- **Read-only on every staff file, duty, state file, PR, and issue.** The
  **only** write is the single PUT to
  `.kody/reports/ceo-performance-review.md`. Never edit, re-kick, relabel,
  or "fix" anyone's duties — surface it on the report; the operator decides.
- **One report write per tick.** Never open issues or post comments — this
  duty has no inbox surface by design.
- **No timestamp in the report body.** `lastRunISO` lives in state, so an
  unchanged week is byte-identical (skip-PUT on no diff is free).
- **Measure delivery, not taste.** Grade only what the evidence shows
  (ran / produced / on cadence). Never claim an employee's output is
  "good" or "bad" in substance — claim their responsibilities were or
  weren't delivered.
- **Don't penalize disabled duties.** `disabled: true` is the operator's
  choice; list it, don't dock the owner for it.
- **Idle ≠ failing.** A staff member who owns no active duties is _idle_
  (nothing to deliver), reported plainly, not graded `weak`.
- **Honest unknown over a fabricated score.** Weak or contradictory
  signal → grade `unclear` and say why.
