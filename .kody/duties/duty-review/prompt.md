# Duty Review

## Job

A **per-duty health check**. Each tick picks **one** duty from
`.kody/duties/` (round-robin) and deep-reviews whether it actually works —
not the plumbing (`system-audit` owns broken refs, missed ticks, stuck
dispatch), but the **design and observed behavior**: does this duty's
procedure achieve its stated goal, are its steps reachable, does its
cadence guard fire, and has it actually been running and producing output?

This duty cannot _execute_ the duty it reviews — there is no way to prove a
duty works live. It reads the duty's instructions plus its real run history
(state file + recent commits + any report it writes) and reasons about
whether the logic is sound and the evidence shows it working. Static review

- evidence, not a live test.

Purely diagnostic: it never edits, re-kicks, or relabels anything. Output is
findings on the **Kody duty review** tracking issue, and an end-of-cycle
summary comment.

**Cadence guard.** If `data.lastRunISO` is set and within the last 6 hours,
emit unchanged state and exit. Otherwise proceed and set `data.lastRunISO`
to now (UTC ISO) before emitting state.

## Tick procedure (one duty reviewed, one comment max)

1. **Pin the repo.** `gh`'s default repo is not guaranteed here — resolve it
   once and pass `--repo` to every `gh issue` call:

   ```
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   ```

2. **Enumerate duties.** List every `<slug>.md` in `.kody/duties/`:

   ```
   gh api "/repos/$REPO/contents/.kody/duties" -q '.[].name'
   ```

   Drop `.state.json` files and **drop `duty-review.md` itself** (don't
   review yourself — same self-exemption as `system-audit`).

3. **Pick the next duty.** From the enumerated slugs sorted alphabetically,
   pick the first one **not** in `data.reviewed`. If every duty is already
   in `data.reviewed`, a full cycle just finished:
   - Post the **end-of-cycle summary** (step 7).
   - Reset `data.reviewed = []`, bump `data.cycle`, and pick the first slug.

4. **Gather evidence** for the picked duty `<slug>`:
   - Body: `gh api "/repos/$REPO/contents/.kody/duties/<slug>.md"` (base64 →
     decode). Read the frontmatter (`every`, `staff`, `disabled`, `mentions`)
     and every section.
   - State: `gh api "/repos/$REPO/contents/.kody/duties/<slug>.state.json"`
     if it exists (404 = never ticked — itself a finding).
   - History: `gh api "/repos/$REPO/commits?path=.kody/duties/<slug>.state.json&per_page=10"`
     to see whether `lastRunISO` is actually advancing, and how often.
   - Report (if the duty writes one, e.g. `.kody/reports/<slug>.md`): fetch
     it to confirm output exists and isn't stale/empty.

5. **Run the review checklist.** Record one finding line per problem, each
   tagged `BROKEN` (the duty cannot achieve its goal as written / evidence
   shows it isn't working) or `WARN` (works but risky/wasteful/ambiguous):
   1. **Goal clarity** — does the `Job` section state one concrete,
      checkable goal? Vague or multi-goal bodies → `WARN`.
   2. **Procedure achieves the goal** — do the per-tick steps actually
      produce the stated output? Dead/unreachable steps, a step whose
      precondition can never be true, or a goal with no step that produces
      it → `BROKEN`.
   3. **Cadence guard correctness** — guard present and consistent with the
      `every:` frontmatter; `nextEligibleISO` formula matches the guard
      window. A guard that can never pass (always exits) or never blocks
      (no guard but a cadence implied) → `BROKEN`.
   4. **State contract** — body emits a closing `kody-job-next-state` block,
      and the schema it documents matches what the procedure actually
      writes. Missing block on a cadence-gated duty → `BROKEN` (it re-fires
      every wake). Documented field never written → `WARN`.
   5. **One-action-max** — the procedure cannot fan out into multiple
      mutations in a single tick. A loop that comments/commits per item →
      `BROKEN`.
   6. **Idempotence / no churn** — a no-change tick produces byte-identical
      output (skip-PUT, quiet-on-clean, integer rounding, no timestamp in
      file bodies). Churn-on-every-tick → `WARN`.
   7. **Allowed-commands vs Restrictions** — the `Allowed Commands` don't
      grant more than the `Restrictions` claim to forbid; no internal
      contradiction. Mismatch → `WARN`.
   8. **Observed behavior** — from history: is `lastRunISO` advancing on
      roughly its cadence? Frozen state (never advanced since creation),
      no state file despite the body promising one, or a `cursor` stuck
      non-terminal for many ticks → `BROKEN`. `disabled: true` duties are
      reviewed for design but **not** flagged for being idle (disabled is
      intentional) — note the disabled status and move on.

6. **Post findings — only when the duty has at least one `BROKEN` or `WARN`.**
   Healthy duties produce **no comment** (the inbox is precious); they're
   recorded in state only. Find or open the tracking issue:

   ```
   ISSUE=$(gh issue list --repo "$REPO" --search "Kody duty review in:title" --state open --limit 1 --json number -q '.[0].number')
   ```

   If empty, open it once (label `kody:duty-review`, create the label first
   if missing):

   ```
   gh issue create --repo "$REPO" --title "Kody duty review" --label "kody:duty-review" \
     --body "Tracking issue for the duty-review duty. Each tick deep-reviews one duty's design and observed behavior; flagged duties get a comment here. Read-only — never close."
   ```

   Then post one comment, lead line `## Duty review — \`<slug>\` — <verdict>`where`<verdict>`is`BROKEN`/`WARN`, followed by the finding lines.
Each line: `- **BROKEN** — <what's wrong>. **Why it matters:** <effect>.`
   Reference the duty section by name (e.g. "Cadence guard", "step 3").

7. **End-of-cycle summary** (only in step 3 when a cycle completes): one
   comment on the tracking issue —
   `## Duty review — cycle <N> complete — reviewed <count>, flagged <m>`
   then a one-line-per-flagged-duty roster (`- \`<slug>\` — <verdict>`).
This is the low-noise "everything got looked at" heartbeat (~once per
full sweep, i.e. every `count × 6h`). Skip the roster if zero flagged.

8. **Emit closing state** (step "State" below) as the very last thing in the
   reply, recording the slug reviewed this tick and its verdict.

## Allowed Commands

- `gh repo view` — pin the repo.
- `gh api` reads against `/repos/$REPO/contents/.kody/duties`, individual
  duty bodies, their `.state.json` files, `.kody/reports/*`, and
  `/repos/$REPO/commits?path=...` for run history.
- `gh issue list --search "Kody duty review in:title"` — find the tracking
  issue.
- `gh issue create --title "Kody duty review" ...` — one-time only if it
  doesn't exist; `gh label create kody:duty-review ...` if the label is
  missing.
- `gh issue comment <n>` against the **Kody duty review** issue only.

## Restrictions

- **Read-only on every duty, state file, report, PR, and issue** except the
  one tracking issue. Never edit, re-kick, relabel, or "fix" the duty you're
  reviewing — surface it; the operator decides.
- **At most one duty reviewed per tick**, and **at most one comment per
  tick** (a findings comment, or the end-of-cycle summary — not both; if a
  cycle completes on the same tick a duty is flagged, post the summary this
  tick and the findings next tick).
- **No file writes.** This duty never modifies the working tree.
- **Quiet on healthy** — no comment when the reviewed duty passes every
  check. The cycle summary is the only routine output.
- **Don't review yourself** (`duty-review`) — self-exempt, like
  `system-audit`.
- **`disabled: true` is not a finding** for the "observed behavior" check —
  disabled duties are idle by intent. Still review their design.
- **Static review + evidence only.** Never claim a duty "works" — claim its
  design is sound and its history shows it running. The two are different.

## State

The engine writes `duty-review.state.json` from the closing block below.

- `cursor`: `reviewed` after any tick past the cadence guard.
- `data.lastRunISO`: UTC ISO timestamp of the last tick that ran past the
  cadence guard.
- `data.nextEligibleISO`: always `lastRunISO + 6h`. **Always emit this,
  every tick** — surfaced as "next run" on the dashboard.
- `data.cycle`: integer, incremented each time a full sweep completes.
- `data.reviewed`: array of slugs reviewed in the **current** cycle (reset
  to `[]` when the cycle completes).
- `data.lastReviewed`: `{ slug, verdict }` reviewed this tick (`verdict` is
  `healthy` / `warn` / `broken`).
- `done`: always `false` — this duty is evergreen.

Closing block shape:

````
```kody-job-next-state
{
  "cursor": "reviewed",
  "data": {
    "lastRunISO": "<now ISO>",
    "nextEligibleISO": "<now ISO + 6h>",
    "cycle": <n>,
    "reviewed": ["architecture-audit", "cleanup-branches"],
    "lastReviewed": { "slug": "cleanup-branches", "verdict": "healthy" }
  },
  "done": false
}
```
````
