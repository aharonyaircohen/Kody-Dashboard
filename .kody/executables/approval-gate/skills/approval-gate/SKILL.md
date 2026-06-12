---
name: approval-gate
description: Review QA goal PRs. Verify each candidate, reject duplicates or failed fixes, and recommend or dispatch merge only when the trust ledger allows it.
---

# Approval Gate Skill

Use this skill when the `approval-gate` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

> Executed by the **CTO** persona. Every 15 minutes, look at the **QA goals'
> deliverable PRs**, verify each one passes a fresh QA pass, drop duplicates,
> and — per the operator's trust ledger — either recommend the merge in the
> inbox or (once the `merge` verb has graduated) auto-merge it. This is the
> reviewer that closes the QA loop: QA finds and fixes, the CTO verifies and
> ships.

## Scope (hard limits)

- **QA-goal PRs only.** A candidate PR is an open, non-draft PR that carries a
  `goal:qa-*` label (the consolidated deliverable of a QA goal). Never act on
  any other PR — normal feature/bug PRs are entirely out of scope here, so the
  `merge` verb can never auto-fire on a non-QA PR.
- The only commands this job may emit are
  `@kody qa-engineer --issue <n> --goal <goal-id>` (verification) and
  `@kody merge --pr <n>` (the squash-merge), and `@kody merge` auto-only when
  the ledger marks it `"auto"`.
- **Advisory by default.** Never merge, approve, label, or close anything
  yourself. The actual merge is done by the engine `merge` primitive via an
  `@kody merge` comment — this job only verifies, recommends, and (when
  graduated) dispatches.
- Never edit files, `git commit`, `git push`, or open a PR. The only write
  path is `gh pr comment` / `gh issue comment`.

## Tick procedure (one action max)

### 1. Read the trust ledger (first, every tick)

```
gh issue list --state open --label kody:cto-decisions --limit 5 --json number,body
```

Take the lowest-numbered match, find the fenced ```json block between
`<!-- kody-cto-decisions:start -->`and`<!-- kody-cto-decisions:end -->`, and
read `staff.cto.merge.mode`. `"auto"`→ the`merge`verb has **graduated** (you
may dispatch it yourself this tick). Anything else —`"ask"`, missing, no
ledger, parse failure, or any doubt → **not graduated**: recommend and wait.
Fail safe. You only ever *read* `mode`; the dashboard owns the graduation math
(10 clean approvals graduates `merge`; one Reject resets it to `"ask"`).

### 2. Enumerate candidate QA PRs (one list call)

```
gh pr list --state open --limit 100 \
  --json number,title,headRefName,baseRefName,isDraft,mergeable,labels,updatedAt
```

Keep only non-draft PRs whose `labels` include one matching `goal:qa-`. Pick
the **oldest by `updatedAt`** that this job hasn't already resolved (see State).
None → idle, emit unchanged state, exit.

### 3. Duplicate check (before anything else)

A QA goal often re-files bugs already fixed by an earlier goal. For the chosen
PR, list recently-merged QA PRs:

```
gh pr list --state merged --limit 30 --search "label:goal:qa- " \
  --json number,title,headRefName
```

If this PR's title/finding clearly **duplicates** an already-merged QA PR (same
bug, same fix area), post a **`reject`** recommendation (format below), stage
the PR `rejected`, and exit. Don't verify or merge a duplicate.

### 4. Verify (delegate to qa-engineer)

Otherwise the PR's fix must pass a fresh QA pass before it can ship:

- **No QA verdict yet on this PR** → dispatch
  `@kody qa-engineer --issue <n> --goal <goal-id>`, where `<goal-id>` is the
  PR's `goal:qa-*` label minus the `goal:` prefix. `--goal` resolves the goal's
  preview deployment to browse; `--issue <n>` posts the verdict on the PR and,
  by design, does **not** create a goal (qa-engineer is advisory when given a
  target). Stage `verifying`, exit.
- **qa-engineer reported `QA PASS`** → go to step 5.
- **qa-engineer reported `QA CONCERNS`/`QA FAIL`** → do **not** merge. Post a
  `reject` rec linking the finding, stage `rejected`, exit.
- **Dispatched ≥ 2h ago, still no verdict** → re-dispatch once, exit (a stuck
  verification must never wedge the gate).

### 5. Act on the merge

PR verified PASS. Command is always `@kody merge --pr <n>`.

- **`merge` not graduated** → post one `approve` recommendation comment on PR
  `<n>` (recommendation format). Stage → `merge-recommended`.
- **`merge` graduated** → post `@kody merge --pr <n>` on the PR, then a
  separate **silent** audit-trail comment (auto-run format — no operator
  mention). Stage → `merge-auto`.

The engine `merge` primitive is **self-gating**: it squash-merges only when
GitHub reports the PR CLEAN (mergeable + required checks/reviews satisfied) and
refuses otherwise. So dispatching `@kody merge` never force-merges a red PR —
it'll comment why and you'll retry on a later tick.

## Comment formats

**Operator handle.** The engine substitutes `{{mentions}}` (this duty's
profile `mentions` list) on the first line. Use the literal `{{mentions}}`
token — never hardcode a handle.

**Recommendation** (`approve` — verb not graduated). MUST `@`-mention the
operator on the first line (that routes it into the dashboard inbox) and carry
the exact command on a single `kody-cmd` line (the inbox **Approve** button
posts it verbatim):

```
{{mentions}} ✅ **CTO approval** — `approve`

QA PR #<n> ("<title>") passed a fresh QA pass. Approving squash-merges it into
the default branch.

<!-- kody-cmd: @kody merge --pr <n> -->

_Confirm or dismiss in the dashboard inbox. The CTO will not merge on its own._
```

**Reject recommendation** (duplicate, or QA verdict failed). Same shape, action
`reject`. There is **no** `kody-cmd` line: closing an unmerged PR isn't an
`@kody` primitive yet (`revert` is for _merged_ commits), so this rec surfaces
the problem and the operator closes the PR manually. Omitting the `kody-cmd`
also means the inbox shows no Approve/auto button — reject-only by design:

```
{{mentions}} 🚫 **CTO approval** — `reject`

QA PR #<n> ("<title>") <duplicates already-merged PR #<m> | failed QA: #<finding>>.
Recommend closing it without merging.

_Review and close in GitHub. (No auto-action — closing an open PR has no `@kody` primitive yet.)_
```

**Auto-run** (`merge` graduated). Post `@kody merge --pr <n>`, then a separate
audit comment that **MUST NOT** `@`-mention the operator (graduation = act
without interrupting them):

```
🚀 **CTO auto-merged** — `merge`

Ran `@kody merge --pr <n>` — QA passed and `merge` is graduated (operator
approved it 10 times running). A **Reject** on `merge` returns me to asking.
```

## Allowed Commands

- `gh issue list --state open --label kody:cto-decisions --limit 5 --json number,body`
- `gh pr list --state open --limit 100 --json number,title,headRefName,baseRefName,isDraft,mergeable,labels,updatedAt`
- `gh pr list --state merged --limit 30 --search "label:goal:qa- " --json number,title,headRefName`
- `gh pr view <n> --json comments` / `gh issue view <n>` — read the qa-engineer verdict.
- `gh pr comment <n> --body "..."` — the only write path (recommendation, or
  the `@kody …` dispatch + its silent follow-up when graduated).

## Restrictions

- The **Scope (hard limits)** apply in full. One action (one PR) per tick.
- Only act when the PR's state is **new** to this job (stage changed — see
  State); never re-post the same recommendation every 15 minutes.
- Never merge directly — always via the self-gating `@kody merge` primitive.
