---
name: "AI Company Orchestration Plan"
description: "7-gap plan: contracts, ledgers, aggregator, write-back, schema, claims, escalation"
type: project
created: 2026-06-07T18:02:22.552Z
---

# AI Company Orchestration — Contracts & Enforcement

## Goal
Turn 7 loose conventions into enforced contracts, built into the dashboard, for repos running in "AI company" mode. No engine changes.

## The 7 Gaps

### 1. Trigger-Duty-to-Staff Contract
- Add `contract:` block to duty frontmatter: `staff`, `reads_from`, `writes_to`, `done_when`
- Dashboard form requires these for chief/ceo duties
- Validates reads/writes resolve to existing ledgers/reports
- "Contract view" page shows duty-to-ledger coupling

### 2. Multi-Section Shared Ledger
- Ledger = GitHub issue with fixed frontmatter schema, labeled `ledger:<section>`
- Sections: `priorities` (CEO), `domain-state/<chief>`, `blockers`, `decisions`
- "Ledgers" page groups by section, shows Kanban view (Active/Backlog/Done)
- Workers can read any ledger but write only to `blockers` via their chief

### 3. Aggregated Report Layer
- `report-aggregator` duty reads all `report://chief/*` reports, writes `report://ceo/weekly`
- CEO's contract binds to `report://ceo/weekly`, not raw chief reports
- Template duty auto-created when "AI company" mode enabled

### 4. Write-Back Channel for CEO Decisions
- CEO contract writes `ledger://priorities` as canonical write-back
- CEO duty posts diff comment on each chief's domain-state ledger after writing priorities
- Chief's "next action" prompt includes unread CEO notifications

### 5. Report Schema
- Shared `.kody/reports/_schema.yaml` with required fields: `id`, `duty_slug`, `role`, `ran_at`, `status`, `summary`, `actions_taken`, `blockers`, `next_steps`
- "Reports" page validates each report; invalid = red badge
- Schema versioned (`schema_version: 1`) for evolution

### 6. The "Done" Claim on the Queue
- Two-step claim protocol: `<!-- claim: <worker-slug> at <ts> -->` then `<!-- done: ... -->`
- Aggregator/chief sees issue as "claimed" if claim exists without done
- "Queues" page shows Pending / Claimed / Done
- Stale claim (default 4h) flagged "re-claim available"

### 7. Escalation Path Between Layers
- Markers: `<!-- escalate-to-chief: <reason> -->`, `<!-- escalate-to-ceo: ... -->`, `<!-- escalate-to-human: ... -->`
- All escalations land in `ledger://blockers` or `ledger://escalations`
- "Blockers" page surfaces unresolved escalations by target layer
- Workers cannot `escalate-to-ceo` directly — must go through chief first

## Implementation Order
1. Report schema (#5) — smallest, blocks #3
2. Ledger sections (#2) — reuse trust ledger pattern
3. Done-claim protocol (#6) — small, define markers
4. Escalation markers (#7) — depends on #2
5. Duty-to-staff contract (#1) — form/template
6. Aggregated report layer (#3) — depends on #1 + #5
7. Write-back channel (#4) — depends on #2 + #3

## Implementation Table
| Gap | Dashboard page | Consumer repo file | Engine change |
|-----|---------------|-------------------|--------------|
| #1 | Duties form | `.kody/duties/<slug>.md` | None |
| #2 | Ledgers view | Issues with `ledger:*` label | None |
| #3 | Reports view | New duty from template | None |
| #4 | Priorities view | `ledger://priorities` issue | None |
| #5 | Reports validation | `.kody/reports/_schema.yaml` | None |
| #6 | Queues view | Issue comments with markers | None |
| #7 | Blockers view | `ledger://blockers` issue | None |

## Open Questions
1. Schema ownership — dashboard owns, repo can override
2. Ledger conflict — append-only with timestamps, dashboard renders chronologically
3. Human override — separate "human decisions" section, surfaced in CEO's next prompt
4. Stale claim timeout — 4 hours default, configurable per repo

**Why:** This plan defines how to enforce AI company contracts without touching the engine.
**How to apply:** Use as the issue body when filing the tracking issue. Reference gaps by number during implementation.
