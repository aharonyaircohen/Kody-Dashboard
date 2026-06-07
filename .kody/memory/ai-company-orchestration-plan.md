---
name: "AI Company Orchestration Plan"
description: "7-gap plan: contracts, ledgers, aggregator, write-back, schema, claims, escalation"
type: project
created: 2026-06-07T18:02:22.552Z
---

7-gap plan for turning loose AI-company conventions into enforced contracts:

1. **Trigger-Duty-to-Staff Contract** — duty frontmatter requires: staff, reads_from, writes_to, done_when. Dashboard form enforces. Validates targets resolve to existing ledgers/reports.

2. **Multi-Section Shared Ledger** — named GitHub issues with `ledger:<section>` label. Sections: priorities (CEO-only write), domain-state/<chief>, blockers, decisions.

3. **Aggregated Report Layer** — `report-aggregator` duty template reads all `report://chief/*` reports, writes `report://ceo/weekly.md`. Auto-created when AI-company mode enabled.

4. **Write-Back Channel for CEO Decisions** — CEO duty writes `ledger://priorities`, posts diff comment on each chief's domain-state ledger. Dashboard routes unread CEO notifications to chief's next tick.

5. **Report Schema** — shared `.kody/reports/_schema.yaml` with required fields: id, duty_slug, role, ran_at, status, summary, actions_taken, blockers, next_steps. Dashboard validates; invalid reports show red badge.

6. **Done-Claim Protocol** — `<!-- claim: <worker> at <ts> -->` + `<!-- done: <worker> at <ts> -->` comment markers on queue issues. Dashboard shows Pending/Claimed/Done. Stale claims flagged after N hours.

7. **Escalation Path Between Layers** — markers: `<!-- escalate-to-chief: <reason> -->`, `<!-- escalate-to-ceo: <reason> -->`, `<!-- escalate-to-human: <reason> -->`. Blockers ledger, dashboard "Blockers" view, inbox routing.

**Implementation order:** #5 schema → #2 ledger → #6 claims → #7 escalation → #1 contracts → #3 aggregator → #4 write-back.

**Zero engine changes.** All dashboard + consumer repo files.

**Open questions:** schema ownership, ledger conflict resolution, human override placement, stale claim timeout. Status: drafted, not yet filed as issue.
