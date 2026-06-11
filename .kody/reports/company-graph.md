---
slug: company-graph
dutySlug: company-graph
generatedAt: "2026-06-11T15:37:29Z"
findings:
  - id: company-graph.snapshot
    severity: low
    title: "Graph snapshot emitted"
    data: {"nodeCounts":{"context":4,"duties":28,"staff":7,"executables":14,"scripts":7,"skills":3,"reports":5,"goals":2,"issues":13},"graphHash":"6d610a339e9e96f648d77a56d6d81f7c9df5a5e9c32980dabd27006f9fab088a"}
  - id: company-graph.stale-context.ai-company-orchestration-plan
    severity: low
    title: "ai-company-orchestration-plan - not declared as reads_from by any duty"
    data: {"context":"ai-company-orchestration-plan"}
  - id: company-graph.stale-context.ideas
    severity: low
    title: "ideas - not declared as reads_from by any duty"
    data: {"context":"ideas"}
  - id: company-graph.stale-context.plan-and-split-execution
    severity: low
    title: "plan-and-split-execution - not declared as reads_from by any duty"
    data: {"context":"plan-and-split-execution"}
  - id: company-graph.coverage-gap.commands
    severity: low
    title: "commands - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/commands"}
  - id: company-graph.coverage-gap.evals
    severity: low
    title: "evals - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/evals"}
  - id: company-graph.coverage-gap.events
    severity: low
    title: "events - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/events"}
  - id: company-graph.coverage-gap.memory
    severity: low
    title: "memory - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/memory"}
  - id: company-graph.coverage-gap.sessions
    severity: low
    title: "sessions - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/sessions"}
  - id: company-graph.coverage-gap.tasks
    severity: low
    title: "tasks - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/tasks"}
---

# Company Graph

| Node type | Count |
|---|---:|
| context | 4 |
| duties | 28 |
| staff | 7 |
| executables | 14 |
| scripts | 7 |
| skills | 3 |
| reports | 5 |
| goals | 2 |
| issues | 13 |

Graph hash: `6d610a339e9e96f648d77a56d6d81f7c9df5a5e9c32980dabd27006f9fab088a`

## Graph
```json
{
  "schemaVersion": 1,
  "nodes": [
    {
      "id": "context:ai-company-orchestration-plan",
      "type": "context",
      "slug": "ai-company-orchestration-plan",
      "staff": [
        "kody"
      ],
      "headingCount": 7
    },
    {
      "id": "context:ideas",
      "type": "context",
      "slug": "ideas",
      "staff": [
        "kody"
      ],
      "headingCount": 0
    },
    {
      "id": "context:orchestration-conventions",
      "type": "context",
      "slug": "orchestration-conventions",
      "staff": [
        "*"
      ],
      "headingCount": 3
    },
    {
      "id": "context:plan-and-split-execution",
      "type": "context",
      "slug": "plan-and-split-execution",
      "staff": [
        "kody"
      ],
      "headingCount": 6
    },
    {
      "id": "duty:approval-gate",
      "type": "duty",
      "slug": "approval-gate",
      "staff": "cto",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:architecture-audit",
      "type": "duty",
      "slug": "architecture-audit",
      "staff": "cto",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:ceo-performance-review",
      "type": "duty",
      "slug": "ceo-performance-review",
      "staff": "ceo",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:cleanup-branches",
      "type": "duty",
      "slug": "cleanup-branches",
      "staff": "kody",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:clear-empty-goals",
      "type": "duty",
      "slug": "clear-empty-goals",
      "staff": "",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:company-graph",
      "type": "duty",
      "slug": "company-graph",
      "staff": "coo",
      "executables": [
        "company-graph"
      ],
      "readsFrom": [
        "orchestration-conventions"
      ],
      "writesTo": [
        "company-graph"
      ],
      "disabled": false
    },
    {
      "id": "duty:coverage-floor",
      "type": "duty",
      "slug": "coverage-floor",
      "staff": "kody",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:dead-code-sweep",
      "type": "duty",
      "slug": "dead-code-sweep",
      "staff": "kody",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:dependency-bump",
      "type": "duty",
      "slug": "dependency-bump",
      "staff": "kody",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:design-review",
      "type": "duty",
      "slug": "design-review",
      "staff": "ux-designer",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:dev-ci-health",
      "type": "duty",
      "slug": "dev-ci-health",
      "staff": "cto",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:docs-code",
      "type": "duty",
      "slug": "docs-code",
      "staff": "tech-writer",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:docs-readme",
      "type": "duty",
      "slug": "docs-readme",
      "staff": "tech-writer",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:duty-review",
      "type": "duty",
      "slug": "duty-review",
      "staff": "coo",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:flaky-test-quarantine",
      "type": "duty",
      "slug": "flaky-test-quarantine",
      "staff": "kody",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:health-check",
      "type": "duty",
      "slug": "health-check",
      "staff": "kody",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:inbox-ping",
      "type": "duty",
      "slug": "inbox-ping",
      "staff": "kody",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:job-gap-scan",
      "type": "duty",
      "slug": "job-gap-scan",
      "staff": "ceo",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:pr-health-triage",
      "type": "duty",
      "slug": "pr-health-triage",
      "staff": "cto",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:publish-release",
      "type": "duty",
      "slug": "publish-release",
      "staff": "kody",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:qa",
      "type": "duty",
      "slug": "qa",
      "staff": "qa",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:qa-sweep",
      "type": "duty",
      "slug": "qa-sweep",
      "staff": "qa",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:qa-verify",
      "type": "duty",
      "slug": "qa-verify",
      "staff": "qa",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:redispatch",
      "type": "duty",
      "slug": "redispatch",
      "staff": "kody",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:security-audit",
      "type": "duty",
      "slug": "security-audit",
      "staff": "kody",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:system-audit",
      "type": "duty",
      "slug": "system-audit",
      "staff": "coo",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:task-memory-extractor",
      "type": "duty",
      "slug": "task-memory-extractor",
      "staff": "coo",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:type-debt",
      "type": "duty",
      "slug": "type-debt",
      "staff": "kody",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "executable:bug",
      "type": "executable",
      "slug": "bug",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Fix a bug / enhancement issue end-to-end in ONE session: reproduce with a failing test → research → plan → fix → verify, then branch, commit, open PR. Single-session — no multi-stage orchestration.",
      "skills": [
        "systematic-debugging"
      ],
      "shellScripts": [
        "install-codegraph.sh"
      ]
    },
    {
      "id": "executable:chore",
      "type": "executable",
      "slug": "chore",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Make a chore / docs / dep-bump change end-to-end in ONE session: minimal investigation → change → verify, then branch, commit, open PR. Low-ceremony (no heavy planning) — single-session, no multi-stage orchestration.",
      "skills": [],
      "shellScripts": []
    },
    {
      "id": "executable:classify",
      "type": "executable",
      "slug": "classify",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Classify an issue into one of {feature, bug, spec, chore} and dispatch the matching sub-orchestrator. Label-first fast path; LLM fallback when labels don't decide.",
      "skills": [],
      "shellScripts": []
    },
    {
      "id": "executable:company-graph",
      "type": "executable",
      "slug": "company-graph",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Derive the company orchestration graph from .kody files and refresh .kody/reports/company-graph.md.",
      "skills": [
        "company-graph"
      ],
      "shellScripts": [
        "refresh-company-graph.sh"
      ]
    },
    {
      "id": "executable:feature",
      "type": "executable",
      "slug": "feature",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Implement a feature / refactor issue end-to-end in ONE session: research → plan → build → test → verify, then branch, commit, open PR. Single-session — no multi-stage orchestration.",
      "skills": [],
      "shellScripts": [
        "install-codegraph.sh"
      ]
    },
    {
      "id": "executable:fix",
      "type": "executable",
      "slug": "fix",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Apply review feedback to an existing PR branch.",
      "skills": [
        "feedback-application"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:fix-ci",
      "type": "executable",
      "slug": "fix-ci",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Fix a failing CI workflow on an existing PR.",
      "skills": [],
      "shellScripts": []
    },
    {
      "id": "executable:plan",
      "type": "executable",
      "slug": "plan",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Research an issue and produce a concrete implementation plan as a comment. Read-only — no branches, no commits.",
      "skills": [],
      "shellScripts": [
        "install-codegraph.sh"
      ]
    },
    {
      "id": "executable:qa-engineer",
      "type": "executable",
      "slug": "qa-engineer",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Free-form QA: browses a running site with Playwright MCP, explores routes, exercises UI states, posts a structured QA report. Opens a new issue per run by default; pass --issue <N> to comment on an existing one. Read-only on the repo.",
      "skills": [],
      "shellScripts": []
    },
    {
      "id": "executable:reproduce",
      "type": "executable",
      "slug": "reproduce",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Write a failing test that reproduces a bug. Do NOT fix the bug — leave the test failing and capture the failure signature so subsequent fix verification can confirm the same failure mode.",
      "skills": [],
      "shellScripts": []
    },
    {
      "id": "executable:research",
      "type": "executable",
      "slug": "research",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Research an issue: understand the ask, map relevant repo context, and surface clarifying questions + gaps. Read-only — no branches, no commits, no prescribed next steps.",
      "skills": [],
      "shellScripts": [
        "install-codegraph.sh"
      ]
    },
    {
      "id": "executable:review",
      "type": "executable",
      "slug": "review",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Read-only structured review of an open PR. Posts one comment, never commits.",
      "skills": [],
      "shellScripts": [
        "install-codegraph.sh"
      ]
    },
    {
      "id": "executable:spec",
      "type": "executable",
      "slug": "spec",
      "role": "orchestrator",
      "kind": "",
      "staff": "",
      "describe": "Sub-orchestrator for spec / RFC / design-doc issues — research → plan (stop). Terminates at the plan artifact; no run, no PR. No agent.",
      "skills": [],
      "shellScripts": []
    },
    {
      "id": "executable:ui-review",
      "type": "executable",
      "slug": "ui-review",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "UI/UX review of an open PR: browses the running preview with Playwright, compares behavior to diff intent, posts one structured review comment. Read-only on the repo (no commits); writes a throwaway Playwright spec under .kody/.",
      "skills": [],
      "shellScripts": []
    },
    {
      "id": "goal:ai-company-orchestration-7-gap-plan",
      "type": "goal",
      "slug": "ai-company-orchestration-7-gap-plan",
      "label": "goal:ai-company-orchestration-7-gap-plan"
    },
    {
      "id": "goal:kody-state-split",
      "type": "goal",
      "slug": "kody-state-split",
      "label": "goal:kody-state-split"
    },
    {
      "id": "issue:50",
      "type": "issue",
      "number": 50,
      "title": "[kody-state-split] 1/5 — Engine: dual-write all state to .kody/state/** on kody-state",
      "state": "OPEN"
    },
    {
      "id": "issue:51",
      "type": "issue",
      "number": 51,
      "title": "[kody-state-split] 2/5 — Migrate existing scattered state files to .kody/state/**",
      "state": "OPEN"
    },
    {
      "id": "issue:52",
      "type": "issue",
      "number": 52,
      "title": "[kody-state-split] 3/5 — Flip readers (dashboard + engine) to new path/branch; unify accessor",
      "state": "OPEN"
    },
    {
      "id": "issue:53",
      "type": "issue",
      "number": 53,
      "title": "[kody-state-split] 4/5 — Stop dual-write, delete stale state from default branch",
      "state": "OPEN"
    },
    {
      "id": "issue:54",
      "type": "issue",
      "number": 54,
      "title": "[kody-state-split] 5/5 — CI path-filter + fix writers hardcoding default branch",
      "state": "OPEN"
    },
    {
      "id": "issue:90",
      "type": "issue",
      "number": 90,
      "title": "[Orchestration] Done-claim protocol — `<!-- claim -->` / `<!-- done -->` markers on issues",
      "state": "CLOSED"
    },
    {
      "id": "issue:91",
      "type": "issue",
      "number": 91,
      "title": "[Orchestration] Report schema — shared YAML frontmatter in `.kody/reports/_schema.yaml`",
      "state": "CLOSED"
    },
    {
      "id": "issue:92",
      "type": "issue",
      "number": 92,
      "title": "[Orchestration] Duty contracts — `reads_from` / `writes_to` / `done_when` in duty frontmatter",
      "state": "OPEN"
    },
    {
      "id": "issue:93",
      "type": "issue",
      "number": 93,
      "title": "[Orchestration] Multi-section ledger — priorities, domain-state, blockers, decisions as labeled GitHub issues",
      "state": "OPEN"
    },
    {
      "id": "issue:94",
      "type": "issue",
      "number": 94,
      "title": "[Orchestration] Escalation markers — `<!-- escalate-to-human -->` with inbox notification",
      "state": "OPEN"
    },
    {
      "id": "issue:95",
      "type": "issue",
      "number": 95,
      "title": "[Orchestration] Aggregated report layer — CEO digest duty reading all chief reports",
      "state": "CLOSED"
    },
    {
      "id": "issue:96",
      "type": "issue",
      "number": 96,
      "title": "[Orchestration] Write-back channel — CEO comments on chief ledgers as plain text",
      "state": "OPEN"
    },
    {
      "id": "issue:97",
      "type": "issue",
      "number": 97,
      "title": "[Dashboard] Add create_goal tool",
      "state": "OPEN"
    },
    {
      "id": "report:ceo-performance-review",
      "type": "report",
      "slug": "ceo-performance-review"
    },
    {
      "id": "report:clear-empty-goals",
      "type": "report",
      "slug": "clear-empty-goals"
    },
    {
      "id": "report:company-graph",
      "type": "report",
      "slug": "company-graph",
      "missing": true
    },
    {
      "id": "report:docs-code",
      "type": "report",
      "slug": "docs-code"
    },
    {
      "id": "report:docs-readme",
      "type": "report",
      "slug": "docs-readme"
    },
    {
      "id": "script:bug/install-codegraph.sh",
      "type": "script",
      "slug": "bug/install-codegraph.sh",
      "path": ".kody/executables/bug/install-codegraph.sh",
      "scope": "executable"
    },
    {
      "id": "script:company-graph/refresh-company-graph.sh",
      "type": "script",
      "slug": "company-graph/refresh-company-graph.sh",
      "path": ".kody/executables/company-graph/refresh-company-graph.sh",
      "scope": "executable"
    },
    {
      "id": "script:feature/install-codegraph.sh",
      "type": "script",
      "slug": "feature/install-codegraph.sh",
      "path": ".kody/executables/feature/install-codegraph.sh",
      "scope": "executable"
    },
    {
      "id": "script:plan/install-codegraph.sh",
      "type": "script",
      "slug": "plan/install-codegraph.sh",
      "path": ".kody/executables/plan/install-codegraph.sh",
      "scope": "executable"
    },
    {
      "id": "script:research/install-codegraph.sh",
      "type": "script",
      "slug": "research/install-codegraph.sh",
      "path": ".kody/executables/research/install-codegraph.sh",
      "scope": "executable"
    },
    {
      "id": "script:review/install-codegraph.sh",
      "type": "script",
      "slug": "review/install-codegraph.sh",
      "path": ".kody/executables/review/install-codegraph.sh",
      "scope": "executable"
    },
    {
      "id": "script:validate-reports",
      "type": "script",
      "slug": "validate-reports",
      "path": ".kody/scripts/validate-reports.sh",
      "scope": "repo"
    },
    {
      "id": "skill:bug/systematic-debugging",
      "type": "skill",
      "slug": "bug/systematic-debugging",
      "name": "systematic-debugging",
      "path": ".kody/executables/bug/skills/systematic-debugging/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:company-graph/company-graph",
      "type": "skill",
      "slug": "company-graph/company-graph",
      "name": "company-graph",
      "path": ".kody/executables/company-graph/skills/company-graph/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:fix/feedback-application",
      "type": "skill",
      "slug": "fix/feedback-application",
      "name": "feedback-application",
      "path": ".kody/executables/fix/skills/feedback-application/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "staff:ceo",
      "type": "staff",
      "slug": "ceo",
      "headingCount": 4
    },
    {
      "id": "staff:coo",
      "type": "staff",
      "slug": "coo",
      "headingCount": 4
    },
    {
      "id": "staff:cto",
      "type": "staff",
      "slug": "cto",
      "headingCount": 4
    },
    {
      "id": "staff:kody",
      "type": "staff",
      "slug": "kody",
      "headingCount": 4
    },
    {
      "id": "staff:qa",
      "type": "staff",
      "slug": "qa",
      "headingCount": 4
    },
    {
      "id": "staff:tech-writer",
      "type": "staff",
      "slug": "tech-writer",
      "headingCount": 4
    },
    {
      "id": "staff:ux-designer",
      "type": "staff",
      "slug": "ux-designer",
      "headingCount": 4
    }
  ],
  "edges": [
    {
      "id": "context:ai-company-orchestration-plan->audience->staff:kody",
      "from": "context:ai-company-orchestration-plan",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "context:ideas->audience->staff:kody",
      "from": "context:ideas",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "context:orchestration-conventions->audience->staff:ceo",
      "from": "context:orchestration-conventions",
      "to": "staff:ceo",
      "relation": "audience"
    },
    {
      "id": "context:orchestration-conventions->audience->staff:coo",
      "from": "context:orchestration-conventions",
      "to": "staff:coo",
      "relation": "audience"
    },
    {
      "id": "context:orchestration-conventions->audience->staff:cto",
      "from": "context:orchestration-conventions",
      "to": "staff:cto",
      "relation": "audience"
    },
    {
      "id": "context:orchestration-conventions->audience->staff:kody",
      "from": "context:orchestration-conventions",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "context:orchestration-conventions->audience->staff:qa",
      "from": "context:orchestration-conventions",
      "to": "staff:qa",
      "relation": "audience"
    },
    {
      "id": "context:orchestration-conventions->audience->staff:tech-writer",
      "from": "context:orchestration-conventions",
      "to": "staff:tech-writer",
      "relation": "audience"
    },
    {
      "id": "context:orchestration-conventions->audience->staff:ux-designer",
      "from": "context:orchestration-conventions",
      "to": "staff:ux-designer",
      "relation": "audience"
    },
    {
      "id": "context:plan-and-split-execution->audience->staff:kody",
      "from": "context:plan-and-split-execution",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "duty:approval-gate->assigned_to->staff:cto",
      "from": "duty:approval-gate",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:architecture-audit->assigned_to->staff:cto",
      "from": "duty:architecture-audit",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:ceo-performance-review->assigned_to->staff:ceo",
      "from": "duty:ceo-performance-review",
      "to": "staff:ceo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:cleanup-branches->assigned_to->staff:kody",
      "from": "duty:cleanup-branches",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:company-graph->assigned_to->staff:coo",
      "from": "duty:company-graph",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:company-graph->reads_from->context:orchestration-conventions",
      "from": "duty:company-graph",
      "to": "context:orchestration-conventions",
      "relation": "reads_from"
    },
    {
      "id": "duty:company-graph->runs->executable:company-graph",
      "from": "duty:company-graph",
      "to": "executable:company-graph",
      "relation": "runs"
    },
    {
      "id": "duty:company-graph->writes_to->report:company-graph",
      "from": "duty:company-graph",
      "to": "report:company-graph",
      "relation": "writes_to"
    },
    {
      "id": "duty:coverage-floor->assigned_to->staff:kody",
      "from": "duty:coverage-floor",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:dead-code-sweep->assigned_to->staff:kody",
      "from": "duty:dead-code-sweep",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:dependency-bump->assigned_to->staff:kody",
      "from": "duty:dependency-bump",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:design-review->assigned_to->staff:ux-designer",
      "from": "duty:design-review",
      "to": "staff:ux-designer",
      "relation": "assigned_to"
    },
    {
      "id": "duty:dev-ci-health->assigned_to->staff:cto",
      "from": "duty:dev-ci-health",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:docs-code->assigned_to->staff:tech-writer",
      "from": "duty:docs-code",
      "to": "staff:tech-writer",
      "relation": "assigned_to"
    },
    {
      "id": "duty:docs-readme->assigned_to->staff:tech-writer",
      "from": "duty:docs-readme",
      "to": "staff:tech-writer",
      "relation": "assigned_to"
    },
    {
      "id": "duty:duty-review->assigned_to->staff:coo",
      "from": "duty:duty-review",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:flaky-test-quarantine->assigned_to->staff:kody",
      "from": "duty:flaky-test-quarantine",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:health-check->assigned_to->staff:kody",
      "from": "duty:health-check",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:inbox-ping->assigned_to->staff:kody",
      "from": "duty:inbox-ping",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:job-gap-scan->assigned_to->staff:ceo",
      "from": "duty:job-gap-scan",
      "to": "staff:ceo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:pr-health-triage->assigned_to->staff:cto",
      "from": "duty:pr-health-triage",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:publish-release->assigned_to->staff:kody",
      "from": "duty:publish-release",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:qa->assigned_to->staff:qa",
      "from": "duty:qa",
      "to": "staff:qa",
      "relation": "assigned_to"
    },
    {
      "id": "duty:qa-sweep->assigned_to->staff:qa",
      "from": "duty:qa-sweep",
      "to": "staff:qa",
      "relation": "assigned_to"
    },
    {
      "id": "duty:qa-verify->assigned_to->staff:qa",
      "from": "duty:qa-verify",
      "to": "staff:qa",
      "relation": "assigned_to"
    },
    {
      "id": "duty:redispatch->assigned_to->staff:kody",
      "from": "duty:redispatch",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:security-audit->assigned_to->staff:kody",
      "from": "duty:security-audit",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:system-audit->assigned_to->staff:coo",
      "from": "duty:system-audit",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:task-memory-extractor->assigned_to->staff:coo",
      "from": "duty:task-memory-extractor",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:type-debt->assigned_to->staff:kody",
      "from": "duty:type-debt",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "executable:bug->runs_preflight->script:bug/install-codegraph.sh",
      "from": "executable:bug",
      "to": "script:bug/install-codegraph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:bug->uses_skill->skill:bug/systematic-debugging",
      "from": "executable:bug",
      "to": "skill:bug/systematic-debugging",
      "relation": "uses_skill"
    },
    {
      "id": "executable:company-graph->runs_preflight->script:company-graph/refresh-company-graph.sh",
      "from": "executable:company-graph",
      "to": "script:company-graph/refresh-company-graph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:company-graph->uses_skill->skill:company-graph/company-graph",
      "from": "executable:company-graph",
      "to": "skill:company-graph/company-graph",
      "relation": "uses_skill"
    },
    {
      "id": "executable:feature->runs_preflight->script:feature/install-codegraph.sh",
      "from": "executable:feature",
      "to": "script:feature/install-codegraph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:fix->uses_skill->skill:fix/feedback-application",
      "from": "executable:fix",
      "to": "skill:fix/feedback-application",
      "relation": "uses_skill"
    },
    {
      "id": "executable:plan->runs_preflight->script:plan/install-codegraph.sh",
      "from": "executable:plan",
      "to": "script:plan/install-codegraph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:research->runs_preflight->script:research/install-codegraph.sh",
      "from": "executable:research",
      "to": "script:research/install-codegraph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:review->runs_preflight->script:review/install-codegraph.sh",
      "from": "executable:review",
      "to": "script:review/install-codegraph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "issue:50->labeled->goal:kody-state-split",
      "from": "issue:50",
      "to": "goal:kody-state-split",
      "relation": "labeled"
    },
    {
      "id": "issue:51->labeled->goal:kody-state-split",
      "from": "issue:51",
      "to": "goal:kody-state-split",
      "relation": "labeled"
    },
    {
      "id": "issue:52->labeled->goal:kody-state-split",
      "from": "issue:52",
      "to": "goal:kody-state-split",
      "relation": "labeled"
    },
    {
      "id": "issue:53->labeled->goal:kody-state-split",
      "from": "issue:53",
      "to": "goal:kody-state-split",
      "relation": "labeled"
    },
    {
      "id": "issue:54->labeled->goal:kody-state-split",
      "from": "issue:54",
      "to": "goal:kody-state-split",
      "relation": "labeled"
    },
    {
      "id": "issue:90->labeled->goal:ai-company-orchestration-7-gap-plan",
      "from": "issue:90",
      "to": "goal:ai-company-orchestration-7-gap-plan",
      "relation": "labeled"
    },
    {
      "id": "issue:91->labeled->goal:ai-company-orchestration-7-gap-plan",
      "from": "issue:91",
      "to": "goal:ai-company-orchestration-7-gap-plan",
      "relation": "labeled"
    },
    {
      "id": "issue:92->labeled->goal:ai-company-orchestration-7-gap-plan",
      "from": "issue:92",
      "to": "goal:ai-company-orchestration-7-gap-plan",
      "relation": "labeled"
    },
    {
      "id": "issue:93->labeled->goal:ai-company-orchestration-7-gap-plan",
      "from": "issue:93",
      "to": "goal:ai-company-orchestration-7-gap-plan",
      "relation": "labeled"
    },
    {
      "id": "issue:94->labeled->goal:ai-company-orchestration-7-gap-plan",
      "from": "issue:94",
      "to": "goal:ai-company-orchestration-7-gap-plan",
      "relation": "labeled"
    },
    {
      "id": "issue:95->labeled->goal:ai-company-orchestration-7-gap-plan",
      "from": "issue:95",
      "to": "goal:ai-company-orchestration-7-gap-plan",
      "relation": "labeled"
    },
    {
      "id": "issue:96->labeled->goal:ai-company-orchestration-7-gap-plan",
      "from": "issue:96",
      "to": "goal:ai-company-orchestration-7-gap-plan",
      "relation": "labeled"
    },
    {
      "id": "issue:97->labeled->goal:ai-company-orchestration-7-gap-plan",
      "from": "issue:97",
      "to": "goal:ai-company-orchestration-7-gap-plan",
      "relation": "labeled"
    }
  ],
  "coverageGaps": [
    "commands",
    "evals",
    "events",
    "memory",
    "sessions",
    "tasks"
  ]
}
```
