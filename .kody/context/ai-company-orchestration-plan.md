---
staff: [kody]
---

# AI Company Orchestration — 7-Gap Plan

See `.kody/memory/ai-company-orchestration-plan.md` for the full plan.

## Summary

Turn 7 loose conventions into enforced contracts:

1. **Duty-to-Staff Contract** — structured `reads_from` / `writes_to` / `done_when` in duty frontmatter
2. **Multi-Section Shared Ledger** — priorities, domain-state, blockers, decisions as labeled GitHub issues
3. **Aggregated Report Layer** — CEO report aggregator duty reading all chief reports
4. **Write-Back Channel** — CEO writes to `ledger://priorities`, diff comments on chief ledgers
5. **Report Schema** — shared YAML frontmatter schema in `.kody/reports/_schema.yaml`
6. **Done-Claim Protocol** — `<!-- claim: -->` / `<!-- done: -->` comment markers on queue issues
7. **Escalation Path** — `<!-- escalate-to-chief/ceo/human -->` markers with routing

## Open Questions

- Schema ownership: dashboard owns, repo can override
- Ledger conflict: append-only with timestamps
- Human override: separate section in priorities ledger
- Stale claim timeout: 4 hours default, configurable per repo

## Implementation Order

1. Report schema → 2. Ledger sections → 3. Done-claim → 4. Escalation markers → 5. Duty contract → 6. Aggregator → 7. Write-back

**Zero engine changes. All dashboard + consumer repo.**
