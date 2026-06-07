---
staff: [kody]
---

# AI Company Orchestration — 7-Gap Plan

Turn 7 loose conventions into enforced contracts.

## Problem Statement

Agents act on stale/invisible claims and there's no shared state between them. Claims get made and forgotten; ledgers go unmaintained; outputs don't connect to decisions.

## Implementation Order

1. **Done-claim protocol** — `<!-- claim: -->` / `<!-- done: -->` comment markers on queue issues
   - **Cost if skipped:** Agents repeat work because no one can see what's been tried or decided
   - **MVP:** Markers on closed issues only
   - **Done when:** Claim markers appear on 80% of closed issues within 2 sprints

2. **Report schema** — shared YAML frontmatter schema in `.kody/reports/_schema.yaml` (dashboard owns; repo can override)
   - **Cost if skipped:** Every duty invents its own format; aggregator can't read outputs
   - **MVP:** One shared schema with `id`, `severity`, `title`, `data` fields
   - **Done when:** All existing reports validate against schema without errors

3. **Duty contracts** — structured `reads_from` / `writes_to` / `done_when` in duty frontmatter
   - **Cost if skipped:** Unclear what a duty owns vs consumes; circular dependencies grow silently
   - **MVP:** `reads_from` and `writes_to` on all scheduled duties
   - **Done when:** No orphan reads (a duty only reads what another duty writes)

4. **Multi-section ledger** — priorities, domain-state, blockers, decisions as labeled GitHub issues; append-only + timestamp; same priority = FIFO
   - **Cost if skipped:** Teams hold state in Slack/Linear/Notion; no single source of truth
   - **MVP:** Four labeled issues (one per section), append-only in comments
   - **Done when:** Ledger reflects same-day state for all open blockers

5. **Escalation markers** — `<!-- escalate-to-chief/ceo/human -->` with routing
   - **Cost if skipped:** Stalls sit in queues indefinitely; no one knows when to step in
   - **MVP:** `<!-- escalate-to-human -->` triggers inbox notification only
   - **Done when:** Every stalled issue has a visible escalation path

6. **Aggregated report layer** — CEO report aggregator duty reading all chief reports
   - **Cost if skipped:** CEOs read 10 reports instead of 1; signal gets lost
   - **MVP:** One aggregator duty that cats chief reports into a single digest
   - **Done when:** CEO reads one digest per day instead of 10 separate reports

7. **Write-back channel** — CEO comments on chief ledgers as plain text (deferred: full routing/inbox logic)
   - **Cost if skipped:** Decisions made at the top don't propagate back down
   - **MVP:** CEO comments appear on chief ledger issues as plain text
   - **Done when:** Chief sees CEO feedback within 4 hours of posting

## Open Decisions (pre-answered)

- **Ledger conflict** → append-only + timestamp; equal entries = escalate flag
- **Human override** → separate `ledger://human` section, never auto-resolved
- **Stale claim timeout** → 4 hours default, configurable per duty
- **Schema ownership** → dashboard owns; repo can override via local `.kody/reports/_schema.yaml`

## Ownership

| Gap | Owner |
|---|---|
| Done-claim protocol | All agents |
| Report schema | Dashboard team |
| Duty contracts | Duty authors |
| Ledger sections | Chief agents |
| Escalation markers | All agents |
| Aggregated layer | Dashboard team |
| Write-back channel | Dashboard team |

## Out of Scope (v1)

- Dashboard UI for ledger view / inbox routing
- Full CEO → ledger write-back with routing logic

## Notes

- Zero engine changes. All dashboard + consumer repo.
- Claims and schema first — cheapest win, validates whether the problem exists.
- If stale claims aren't an issue in practice, gaps 3–7 may not be needed.
