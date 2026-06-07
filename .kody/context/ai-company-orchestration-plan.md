---
staff: [kody]
---

# AI Company Orchestration — 7-Gap Plan

Turn 7 loose conventions into enforced contracts.

## Implementation Order

1. **Done-claim protocol** — `<!-- claim: -->` / `<!-- done: -->` comment markers on queue issues
2. **Report schema** — shared YAML frontmatter schema in `.kody/reports/_schema.yaml` (dashboard owns; repo can override via local `.kody/reports/_schema.yaml`)
3. **Duty contracts** — structured `reads_from` / `writes_to` / `done_when` in duty frontmatter
4. **Multi-section ledger** — priorities, domain-state, blockers, decisions as labeled GitHub issues; append-only + timestamp; same priority = FIFO
5. **Escalation markers** — `<!-- escalate-to-chief/ceo/human -->` with routing
6. **Aggregated report layer** — CEO report aggregator duty reading all chief reports
7. **Write-back channel** — CEO comments on chief ledgers as plain text (deferred: full routing/inbox logic)

## Open Decisions (pre-answered)

- **Ledger conflict** → append-only + timestamp; equal entries = escalate flag
- **Human override** → separate `ledger://human` section, never auto-resolved
- **Stale claim timeout** → 4 hours default, configurable per duty

## Out of Scope (v1)

- Dashboard UI for ledger view / inbox routing
- Full CEO → ledger write-back with routing logic

## Notes

- Zero engine changes. All dashboard + consumer repo.
- Start with claims + schema first — cheapest win, validates whether the problem exists.
- Cut full write-back for v1; plain comments ship value without routing complexity.
- Each gap should have a "what breaks if we don't" line for prioritization.
