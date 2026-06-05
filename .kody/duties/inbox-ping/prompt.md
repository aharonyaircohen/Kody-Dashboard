# Inbox Ping (verification heartbeat)

## Job

A no-op verification duty: **every tick, post exactly one inbox recommendation**
confirming the duty → inbox pipeline is alive. It inspects nothing and mutates no
repo state — its sole purpose is to prove that a duty's `@`-mention reaches the
dashboard inbox. There is **no cadence guard**: every tick fires one heartbeat.

**Per tick (one action max):**

1. Find (or open) the heartbeat tracking issue:
   `gh issue list --repo {owner}/{repo} --label kody:inbox-ping --state open --json number`
   - none open →
     `gh issue create --repo {owner}/{repo} --title "Inbox ping" --label kody:inbox-ping --body "Heartbeat target for the inbox-ping verification duty. Read-only — leave open."`
2. Post the recommendation comment (format below) on that issue, then exit. The
   comment is your single mutation this tick.

## Inbox recommendation format

One comment, terse. It **MUST** `@`-mention the operator on the first line —
that mention is the only thing that routes it into the dashboard inbox:

```
{{mentions}} 📡 **Inbox ping** — `note`

Inbox pipeline check at <UTC ISO>. Seeing this in the dashboard inbox confirms
duty → @-mention → feed → UI is working end to end.

<!-- kody-cmd: @kody noop -->

_Confirm or dismiss in the dashboard inbox. This is a heartbeat — no action needed._
```

## Allowed Commands

- `gh issue list`, `gh issue create`, `gh issue comment` (label `kody:inbox-ping`).

## Restrictions

- **One comment per tick.** Never commit, push, open a PR, merge, approve,
  label anything else, or close the heartbeat issue.
- Read-only beyond the single heartbeat comment.

## State

- `cursor`: always `idle`.
- `data.lastPingISO`: ISO timestamp of the last heartbeat comment.
- `data.nextEligibleISO`: always emit (`now` — no cadence guard).
- `done`: always `false` — evergreen.
