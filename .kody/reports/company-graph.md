---
slug: company-graph
dutySlug: company-graph
generatedAt: "2026-06-21T06:45:16Z"
findings:
  - id: company-graph.snapshot
    severity: low
    title: "Graph snapshot emitted"
    data: {"nodeCounts":{"context":11,"duties":49,"staff":7,"executables":60,"scripts":16,"skills":85,"reports":10,"goals":1,"issues":7},"graphHash":"96b77a994ccf1b828a2277eaedfcaadc8ec68e171f8bb541c21334192d67d4f4"}
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
  - id: company-graph.coverage-gap.goals
    severity: low
    title: "goals - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/goals"}
  - id: company-graph.coverage-gap.memory
    severity: low
    title: "memory - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/memory"}
  - id: company-graph.coverage-gap.runs
    severity: low
    title: "runs - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/runs"}
  - id: company-graph.coverage-gap.sessions
    severity: low
    title: "sessions - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/sessions"}
  - id: company-graph.coverage-gap.tasks
    severity: low
    title: "tasks - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/tasks"}
  - id: company-graph.coverage-gap.terminal
    severity: low
    title: "terminal - present in .kody/ but has no nodes"
    data: {"subfolder":".kody/terminal"}
---

# Company Graph

| Node type | Count |
|---|---:|
| context | 11 |
| duties | 49 |
| staff | 7 |
| executables | 60 |
| scripts | 16 |
| skills | 85 |
| reports | 10 |
| goals | 1 |
| issues | 7 |

Graph hash: `96b77a994ccf1b828a2277eaedfcaadc8ec68e171f8bb541c21334192d67d4f4`

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
      "id": "context:ci-health-graph",
      "type": "context",
      "slug": "ci-health-graph",
      "staff": [
        "*"
      ],
      "headingCount": 4
    },
    {
      "id": "context:company-graph",
      "type": "context",
      "slug": "company-graph",
      "staff": [
        "*"
      ],
      "headingCount": 4
    },
    {
      "id": "context:dependency-graph",
      "type": "context",
      "slug": "dependency-graph",
      "staff": [
        "*"
      ],
      "headingCount": 1
    },
    {
      "id": "context:docs-graph",
      "type": "context",
      "slug": "docs-graph",
      "staff": [
        "*"
      ],
      "headingCount": 1
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
      "id": "context:memory-compaction",
      "type": "context",
      "slug": "memory-compaction",
      "staff": [
        "*"
      ],
      "headingCount": 1
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
      "id": "context:pr-graph",
      "type": "context",
      "slug": "pr-graph",
      "staff": [
        "*"
      ],
      "headingCount": 1
    },
    {
      "id": "context:reports",
      "type": "context",
      "slug": "reports",
      "staff": [
        "*"
      ],
      "headingCount": 1
    },
    {
      "id": "duty:approval-gate",
      "type": "duty",
      "slug": "approval-gate",
      "staff": "",
      "executables": [
        "approval-gate"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:bug",
      "type": "duty",
      "slug": "bug",
      "staff": "",
      "executables": [
        "bug"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:ceo-performance-review",
      "type": "duty",
      "slug": "ceo-performance-review",
      "staff": "",
      "executables": [
        "ceo-performance-review"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:chore",
      "type": "duty",
      "slug": "chore",
      "staff": "",
      "executables": [
        "chore"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:classify",
      "type": "duty",
      "slug": "classify",
      "staff": "",
      "executables": [
        "classify"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:cleanup",
      "type": "duty",
      "slug": "cleanup",
      "staff": "",
      "executables": [
        "cleanup"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:code-health",
      "type": "duty",
      "slug": "code-health",
      "staff": "",
      "executables": [
        "code-health"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:company-graph",
      "type": "duty",
      "slug": "company-graph",
      "staff": "",
      "executables": [
        "company-graph"
      ],
      "readsFrom": [
        "company-graph",
        "orchestration-conventions"
      ],
      "writesTo": [
        "company-graph"
      ],
      "disabled": false
    },
    {
      "id": "duty:delivery-graph",
      "type": "duty",
      "slug": "delivery-graph",
      "staff": "",
      "executables": [
        "delivery-graph"
      ],
      "readsFrom": [
        "ci-health-graph",
        "pr-graph"
      ],
      "writesTo": [
        "ci-health-graph",
        "pr-graph"
      ],
      "disabled": false
    },
    {
      "id": "duty:design-review",
      "type": "duty",
      "slug": "design-review",
      "staff": "",
      "executables": [
        "design-review"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:dev-ci-health",
      "type": "duty",
      "slug": "dev-ci-health",
      "staff": "",
      "executables": [
        "dev-ci-health"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:docs-health",
      "type": "duty",
      "slug": "docs-health",
      "staff": "",
      "executables": [
        "docs-health"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:duty-call",
      "type": "duty",
      "slug": "duty-call",
      "staff": "",
      "executables": [
        "duty-call"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:duty-review",
      "type": "duty",
      "slug": "duty-review",
      "staff": "",
      "executables": [
        "duty-review"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:feature",
      "type": "duty",
      "slug": "feature",
      "staff": "",
      "executables": [
        "feature"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:fix",
      "type": "duty",
      "slug": "fix",
      "staff": "",
      "executables": [
        "fix"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:fix-ci",
      "type": "duty",
      "slug": "fix-ci",
      "staff": "",
      "executables": [
        "fix-ci"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:health-check",
      "type": "duty",
      "slug": "health-check",
      "staff": "",
      "executables": [
        "health-check"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:kody-analyzer",
      "type": "duty",
      "slug": "kody-analyzer",
      "staff": "",
      "executables": [
        "kody-chat"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:kody-mem",
      "type": "duty",
      "slug": "kody-mem",
      "staff": "",
      "executables": [
        "kody-chat"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:kody-operator",
      "type": "duty",
      "slug": "kody-operator",
      "staff": "",
      "executables": [
        "kody-chat"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:kody-vibe",
      "type": "duty",
      "slug": "kody-vibe",
      "staff": "",
      "executables": [
        "kody-chat"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:memory-compaction",
      "type": "duty",
      "slug": "memory-compaction",
      "staff": "",
      "executables": [
        "compact-memory"
      ],
      "readsFrom": [
        "memory-compaction",
        "reports"
      ],
      "writesTo": [
        "memory-compaction"
      ],
      "disabled": false
    },
    {
      "id": "duty:plan",
      "type": "duty",
      "slug": "plan",
      "staff": "",
      "executables": [
        "plan"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:pr-health-triage",
      "type": "duty",
      "slug": "pr-health-triage",
      "staff": "",
      "executables": [
        "pr-health-triage"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:qa",
      "type": "duty",
      "slug": "qa",
      "staff": "",
      "executables": [
        "qa"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:qa-engineer",
      "type": "duty",
      "slug": "qa-engineer",
      "staff": "",
      "executables": [
        "qa-engineer"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:qa-sweep",
      "type": "duty",
      "slug": "qa-sweep",
      "staff": "",
      "executables": [
        "qa-sweep"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:qa-verify",
      "type": "duty",
      "slug": "qa-verify",
      "staff": "",
      "executables": [
        "qa-verify"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:quality-watch",
      "type": "duty",
      "slug": "quality-watch",
      "staff": "",
      "executables": [
        "quality-watch"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:redispatch",
      "type": "duty",
      "slug": "redispatch",
      "staff": "",
      "executables": [
        "redispatch"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:release",
      "type": "duty",
      "slug": "release",
      "staff": "kody",
      "executables": [
        "release"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:repo-graph",
      "type": "duty",
      "slug": "repo-graph",
      "staff": "",
      "executables": [
        "repo-graph"
      ],
      "readsFrom": [
        "dependency-graph",
        "docs-graph"
      ],
      "writesTo": [
        "dependency-graph",
        "docs-graph"
      ],
      "disabled": false
    },
    {
      "id": "duty:reproduce",
      "type": "duty",
      "slug": "reproduce",
      "staff": "",
      "executables": [
        "reproduce"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:research",
      "type": "duty",
      "slug": "research",
      "staff": "",
      "executables": [
        "research"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:resolve",
      "type": "duty",
      "slug": "resolve",
      "staff": "",
      "executables": [
        "resolve"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:revert",
      "type": "duty",
      "slug": "revert",
      "staff": "",
      "executables": [
        "revert"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:review",
      "type": "duty",
      "slug": "review",
      "staff": "",
      "executables": [
        "review"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:skills-research",
      "type": "duty",
      "slug": "skills-research",
      "staff": "",
      "executables": [
        "skills-research"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:spec",
      "type": "duty",
      "slug": "spec",
      "staff": "",
      "executables": [
        "spec"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:sync",
      "type": "duty",
      "slug": "sync",
      "staff": "",
      "executables": [
        "sync"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:system-audit",
      "type": "duty",
      "slug": "system-audit",
      "staff": "",
      "executables": [
        "system-audit"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:task-leader",
      "type": "duty",
      "slug": "task-leader",
      "staff": "kody",
      "executables": [
        "task-leader"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:task-memorize",
      "type": "duty",
      "slug": "task-memorize",
      "staff": "",
      "executables": [
        "task-memorize"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:task-verifier",
      "type": "duty",
      "slug": "task-verifier",
      "staff": "kody",
      "executables": [
        "task-verifier"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:ui-review",
      "type": "duty",
      "slug": "ui-review",
      "staff": "",
      "executables": [
        "ui-review"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:vercel-dev-deploy",
      "type": "duty",
      "slug": "vercel-dev-deploy",
      "staff": "",
      "executables": [
        "vercel-dev-deploy"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:vercel-production-deploy",
      "type": "duty",
      "slug": "vercel-production-deploy",
      "staff": "",
      "executables": [
        "vercel-production-deploy"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:work-briefing",
      "type": "duty",
      "slug": "work-briefing",
      "staff": "",
      "executables": [
        "work-briefing"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "executable:approval-gate",
      "type": "executable",
      "slug": "approval-gate",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Review QA goal PRs. Verify each candidate, reject duplicates or failed fixes, and recommend or dispatch merge only when the trust ledger allows it.",
      "skills": [
        "approval-gate"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:architecture-audit",
      "type": "executable",
      "slug": "architecture-audit",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Run a periodic architecture-health sweep for boundaries, coupling, dependency direction, dead abstractions, and duplication.",
      "skills": [
        "architecture-audit"
      ],
      "shellScripts": []
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
      "id": "executable:ceo-performance-review",
      "type": "executable",
      "slug": "ceo-performance-review",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Review every staff member by the duties they own and the evidence those duties produce.",
      "skills": [
        "ceo-performance-review"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:chore",
      "type": "executable",
      "slug": "chore",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Make a chore / docs / dep-bump change end-to-end in ONE session: minimal investigation → change → verify, then branch, commit, open PR. Low-ceremony (no heavy planning) — single-session, no multi-stage orchestration.",
      "skills": [
        "chore-session"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:ci-health-graph",
      "type": "executable",
      "slug": "ci-health-graph",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Derive CI health from GitHub workflow runs and PR checks, then refresh .kody/reports/ci-health-graph.md.",
      "skills": [
        "ci-health-graph"
      ],
      "shellScripts": [
        "refresh-ci-health-graph.sh"
      ]
    },
    {
      "id": "executable:classify",
      "type": "executable",
      "slug": "classify",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Classify an issue into one of {feature, bug, spec, chore} and dispatch the matching sub-orchestrator. Label-first fast path; LLM fallback when labels don't decide.",
      "skills": [
        "issue-classification"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:cleanup",
      "type": "executable",
      "slug": "cleanup",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Coordinate branches, empty goals, stale dependency nudges, and dead-code cleanup signals.",
      "skills": [
        "clear-empty-goals",
        "cleanup-branches",
        "dependency-bump",
        "dead-code-sweep"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:code-health",
      "type": "executable",
      "slug": "code-health",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Coordinate architecture and TypeScript debt code-health signals.",
      "skills": [
        "architecture-audit",
        "type-debt"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:compact-memory",
      "type": "executable",
      "slug": "compact-memory",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Analyze memory footprint and refresh a safe compaction proposal report.",
      "skills": [
        "compact-memory"
      ],
      "shellScripts": [
        "refresh-memory-compaction.sh"
      ]
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
      "id": "executable:coverage-floor",
      "type": "executable",
      "slug": "coverage-floor",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Check CI coverage against the floor and escalate when statements or branches drop too low.",
      "skills": [
        "coverage-floor"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:dead-code-sweep",
      "type": "executable",
      "slug": "dead-code-sweep",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Coordinate monthly cleanup of unused exports, files, and dependencies.",
      "skills": [
        "dead-code-sweep"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:delivery-graph",
      "type": "executable",
      "slug": "delivery-graph",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Refresh delivery context by deriving CI health and pull request flow reports.",
      "skills": [
        "ci-health-graph",
        "pr-graph"
      ],
      "shellScripts": [
        "refresh-delivery-graphs.sh"
      ]
    },
    {
      "id": "executable:dependency-bump",
      "type": "executable",
      "slug": "dependency-bump",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Track stale production dependencies and keep at most one bump PR in flight.",
      "skills": [
        "dependency-bump"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:dependency-graph",
      "type": "executable",
      "slug": "dependency-graph",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Derive dependency structure from package manifests and lockfiles, then refresh .kody/reports/dependency-graph.md.",
      "skills": [
        "dependency-graph"
      ],
      "shellScripts": [
        "refresh-dependency-graph.sh"
      ]
    },
    {
      "id": "executable:design-review",
      "type": "executable",
      "slug": "design-review",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Run a periodic design-health sweep for visual coherence, usability, and accessibility risks.",
      "skills": [
        "design-review"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:dev-ci-health",
      "type": "executable",
      "slug": "dev-ci-health",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Watch the `dev` branch CI and open or reuse one tracking issue when the branch is red.",
      "skills": [
        "dev-ci-health",
        "github-actions-docs"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:docs-code",
      "type": "executable",
      "slug": "docs-code",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Find important source folders or modules that lack useful in-code documentation.",
      "skills": [
        "docs-code"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:docs-graph",
      "type": "executable",
      "slug": "docs-graph",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Derive documentation topology from markdown files, then refresh .kody/reports/docs-graph.md.",
      "skills": [
        "docs-graph"
      ],
      "shellScripts": [
        "refresh-docs-graph.sh"
      ]
    },
    {
      "id": "executable:docs-health",
      "type": "executable",
      "slug": "docs-health",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Catch documentation drift from merged PRs and broad in-code documentation coverage gaps.",
      "skills": [
        "docs-readme",
        "docs-code"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:docs-readme",
      "type": "executable",
      "slug": "docs-readme",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Check merged PRs for documented areas that changed without matching markdown documentation updates.",
      "skills": [
        "docs-readme"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:duty-call",
      "type": "executable",
      "slug": "duty-call",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Propose one high-ROI missing duty that the system does not already have.",
      "skills": [
        "duty-call"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:duty-review",
      "type": "executable",
      "slug": "duty-review",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Review one duty at a time for design soundness, reachable steps, cadence, and observed output.",
      "skills": [
        "duty-review"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:extract-design-system",
      "type": "executable",
      "slug": "extract-design-system",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Extract starter design tokens from a public URL and compare them to the local dashboard theme.",
      "skills": [
        "extract-design-system"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:feature",
      "type": "executable",
      "slug": "feature",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Implement a feature / refactor issue end-to-end in ONE session: research → plan → build → test → verify, then branch, commit, open PR. Single-session — no multi-stage orchestration.",
      "skills": [
        "implementation-session",
        "design-system",
        "frontend-design",
        "shadcn",
        "vercel-react-best-practices",
        "next-best-practices"
      ],
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
      "skills": [
        "ci-repair",
        "github-actions-docs"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:flaky-test-quarantine",
      "type": "executable",
      "slug": "flaky-test-quarantine",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Watch CI retry patterns and escalate tests that repeatedly fail then pass on rerun.",
      "skills": [
        "flaky-test-quarantine"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:health-check",
      "type": "executable",
      "slug": "health-check",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Report Kody-assigned tasks that have not been updated within the expected window.",
      "skills": [
        "health-check"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:kody-chat",
      "type": "executable",
      "slug": "kody-chat",
      "role": "chat",
      "kind": "",
      "staff": "",
      "describe": "In-process dashboard chat — research, planning, and creation flows wired against the connected repo.",
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
      "skills": [
        "implementation-planning",
        "design-system",
        "frontend-design",
        "shadcn",
        "vercel-react-best-practices",
        "next-best-practices"
      ],
      "shellScripts": [
        "install-codegraph.sh"
      ]
    },
    {
      "id": "executable:pr-graph",
      "type": "executable",
      "slug": "pr-graph",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Derive pull request flow from GitHub PR metadata, then refresh .kody/reports/pr-graph.md.",
      "skills": [
        "pr-graph"
      ],
      "shellScripts": [
        "refresh-pr-graph.sh"
      ]
    },
    {
      "id": "executable:pr-health-triage",
      "type": "executable",
      "slug": "pr-health-triage",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Review open PRs for conflicts, failed CI, or stale branches, then recommend or dispatch the trusted repair.",
      "skills": [
        "pr-health-triage"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:qa",
      "type": "executable",
      "slug": "qa",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Verify shipped but unverified changelog entries against the live app.",
      "skills": [
        "qa"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:qa-engineer",
      "type": "executable",
      "slug": "qa-engineer",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Free-form QA: browses a running site with Playwright MCP, explores routes, exercises UI states, posts a structured QA report. Opens a new issue per run by default; pass --issue <N> to comment on an existing one. Read-only on the repo.",
      "skills": [
        "qa-session",
        "webapp-testing"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:qa-sweep",
      "type": "executable",
      "slug": "qa-sweep",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Run broad exploratory QA against the live app and summarize actionable findings.",
      "skills": [
        "qa-sweep"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:qa-verify",
      "type": "executable",
      "slug": "qa-verify",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Re-check delivery PRs against their previews before merge and route pass/fail outcomes to the inbox.",
      "skills": [
        "qa-verify"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:quality-watch",
      "type": "executable",
      "slug": "quality-watch",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Coordinate security, coverage, and flaky-test quality signals.",
      "skills": [
        "security-audit",
        "coverage-floor",
        "flaky-test-quarantine"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:redispatch",
      "type": "executable",
      "slug": "redispatch",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Find Kody-owned issues that appear stuck and safely redispatch them.",
      "skills": [
        "redispatch"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:release",
      "type": "executable",
      "slug": "release",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Branch-aware release flow. Opens the version PR into the configured integration branch, tags the merged commit, creates the GitHub Release, and opens a promotion PR only when integration and production branches differ.",
      "skills": [
        "release-prepare",
        "release-merge",
        "release-tag",
        "release-promote"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:repo-graph",
      "type": "executable",
      "slug": "repo-graph",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Refresh repository topology by deriving dependency and documentation graph reports.",
      "skills": [
        "dependency-graph",
        "docs-graph"
      ],
      "shellScripts": [
        "refresh-repo-graphs.sh"
      ]
    },
    {
      "id": "executable:reproduce",
      "type": "executable",
      "slug": "reproduce",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Write a failing test that reproduces a bug. Do NOT fix the bug — leave the test failing and capture the failure signature so subsequent fix verification can confirm the same failure mode.",
      "skills": [
        "bug-reproduction"
      ],
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
      "skills": [
        "issue-research"
      ],
      "shellScripts": [
        "install-codegraph.sh"
      ]
    },
    {
      "id": "executable:resolve",
      "type": "executable",
      "slug": "resolve",
      "missing": true
    },
    {
      "id": "executable:revert",
      "type": "executable",
      "slug": "revert",
      "missing": true
    },
    {
      "id": "executable:review",
      "type": "executable",
      "slug": "review",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Read-only structured review of an open PR. Posts one comment, never commits.",
      "skills": [
        "code-review",
        "design-system",
        "vercel-react-best-practices",
        "next-best-practices",
        "web-design-guidelines"
      ],
      "shellScripts": [
        "install-codegraph.sh"
      ]
    },
    {
      "id": "executable:security-audit",
      "type": "executable",
      "slug": "security-audit",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Coordinate a security posture sweep covering dependencies, application code, and supply chain risks.",
      "skills": [
        "security-audit"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:skills-research",
      "type": "executable",
      "slug": "skills-research",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Research useful skills from skills.sh and recommend where they fit in Kody Dashboard.",
      "skills": [
        "skills-research"
      ],
      "shellScripts": []
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
      "id": "executable:sync",
      "type": "executable",
      "slug": "sync",
      "missing": true
    },
    {
      "id": "executable:system-audit",
      "type": "executable",
      "slug": "system-audit",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Audit `.kody/` coordination for broken references, missed ticks, missing state, stuck dispatches, and duplicate dispatches.",
      "skills": [
        "system-audit"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:task-leader",
      "type": "executable",
      "slug": "task-leader",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Task leader — orchestrates reviews, fixes, merges, and dispatches every 15 minutes.",
      "skills": [
        "task-leader-rules"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:task-memorize",
      "type": "executable",
      "slug": "task-memorize",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Turn task and execution experience into durable `.kody/memory/` entries.",
      "skills": [
        "task-memorize"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:task-verifier",
      "type": "executable",
      "slug": "task-verifier",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Task verifier — deep analysis of backlog issues, verdict to verified or needs-human.",
      "skills": [
        "verifier-method"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:type-debt",
      "type": "executable",
      "slug": "type-debt",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Track TypeScript escape hatches and escalate meaningful growth week over week.",
      "skills": [
        "type-debt"
      ],
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
      "skills": [
        "ui-review",
        "design-system",
        "web-design-guidelines",
        "webapp-testing"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:vercel-dev-deploy",
      "type": "executable",
      "slug": "vercel-dev-deploy",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Deploy dev branch to Vercel Preview and move the stable dev preview alias.",
      "skills": [],
      "shellScripts": [
        "vercel-dev-deploy.sh"
      ]
    },
    {
      "id": "executable:vercel-production-deploy",
      "type": "executable",
      "slug": "vercel-production-deploy",
      "role": "primitive",
      "kind": "",
      "staff": "",
      "describe": "Deploy main branch to Vercel Production.",
      "skills": [],
      "shellScripts": [
        "vercel-production-deploy.sh"
      ]
    },
    {
      "id": "executable:work-briefing",
      "type": "executable",
      "slug": "work-briefing",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Summarize current reports, tasks, reviews, running work, and waiting decisions by importance.",
      "skills": [
        "work-briefing"
      ],
      "shellScripts": []
    },
    {
      "id": "goal:ai-company-orchestration-7-gap-plan",
      "type": "goal",
      "slug": "ai-company-orchestration-7-gap-plan",
      "label": "goal:ai-company-orchestration-7-gap-plan"
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
      "id": "report:ci-health-graph",
      "type": "report",
      "slug": "ci-health-graph",
      "missing": true
    },
    {
      "id": "report:clear-empty-goals",
      "type": "report",
      "slug": "clear-empty-goals"
    },
    {
      "id": "report:company-graph",
      "type": "report",
      "slug": "company-graph"
    },
    {
      "id": "report:dependency-graph",
      "type": "report",
      "slug": "dependency-graph",
      "missing": true
    },
    {
      "id": "report:docs-code",
      "type": "report",
      "slug": "docs-code"
    },
    {
      "id": "report:docs-graph",
      "type": "report",
      "slug": "docs-graph",
      "missing": true
    },
    {
      "id": "report:docs-readme",
      "type": "report",
      "slug": "docs-readme"
    },
    {
      "id": "report:memory-compaction",
      "type": "report",
      "slug": "memory-compaction",
      "missing": true
    },
    {
      "id": "report:pr-graph",
      "type": "report",
      "slug": "pr-graph",
      "missing": true
    },
    {
      "id": "script:bug/install-codegraph.sh",
      "type": "script",
      "slug": "bug/install-codegraph.sh",
      "path": ".kody/executables/bug/install-codegraph.sh",
      "scope": "executable"
    },
    {
      "id": "script:ci-health-graph/refresh-ci-health-graph.sh",
      "type": "script",
      "slug": "ci-health-graph/refresh-ci-health-graph.sh",
      "path": ".kody/executables/ci-health-graph/refresh-ci-health-graph.sh",
      "scope": "executable"
    },
    {
      "id": "script:compact-memory/refresh-memory-compaction.sh",
      "type": "script",
      "slug": "compact-memory/refresh-memory-compaction.sh",
      "path": ".kody/executables/compact-memory/refresh-memory-compaction.sh",
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
      "id": "script:delivery-graph/refresh-delivery-graphs.sh",
      "type": "script",
      "slug": "delivery-graph/refresh-delivery-graphs.sh",
      "path": ".kody/executables/delivery-graph/refresh-delivery-graphs.sh",
      "scope": "executable"
    },
    {
      "id": "script:dependency-graph/refresh-dependency-graph.sh",
      "type": "script",
      "slug": "dependency-graph/refresh-dependency-graph.sh",
      "path": ".kody/executables/dependency-graph/refresh-dependency-graph.sh",
      "scope": "executable"
    },
    {
      "id": "script:docs-graph/refresh-docs-graph.sh",
      "type": "script",
      "slug": "docs-graph/refresh-docs-graph.sh",
      "path": ".kody/executables/docs-graph/refresh-docs-graph.sh",
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
      "id": "script:pr-graph/refresh-pr-graph.sh",
      "type": "script",
      "slug": "pr-graph/refresh-pr-graph.sh",
      "path": ".kody/executables/pr-graph/refresh-pr-graph.sh",
      "scope": "executable"
    },
    {
      "id": "script:repo-graph/refresh-repo-graphs.sh",
      "type": "script",
      "slug": "repo-graph/refresh-repo-graphs.sh",
      "path": ".kody/executables/repo-graph/refresh-repo-graphs.sh",
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
      "id": "script:vercel-dev-deploy/vercel-dev-deploy.sh",
      "type": "script",
      "slug": "vercel-dev-deploy/vercel-dev-deploy.sh",
      "path": ".kody/executables/vercel-dev-deploy/vercel-dev-deploy.sh",
      "scope": "executable"
    },
    {
      "id": "script:vercel-production-deploy/vercel-production-deploy.sh",
      "type": "script",
      "slug": "vercel-production-deploy/vercel-production-deploy.sh",
      "path": ".kody/executables/vercel-production-deploy/vercel-production-deploy.sh",
      "scope": "executable"
    },
    {
      "id": "skill:approval-gate/approval-gate",
      "type": "skill",
      "slug": "approval-gate/approval-gate",
      "name": "approval-gate",
      "path": ".kody/executables/approval-gate/skills/approval-gate/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:architecture-audit/architecture-audit",
      "type": "skill",
      "slug": "architecture-audit/architecture-audit",
      "name": "architecture-audit",
      "path": ".kody/executables/architecture-audit/skills/architecture-audit/SKILL.md",
      "scope": "executable"
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
      "id": "skill:ceo-performance-review/ceo-performance-review",
      "type": "skill",
      "slug": "ceo-performance-review/ceo-performance-review",
      "name": "ceo-performance-review",
      "path": ".kody/executables/ceo-performance-review/skills/ceo-performance-review/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:chore/chore-session",
      "type": "skill",
      "slug": "chore/chore-session",
      "name": "chore-session",
      "path": ".kody/executables/chore/skills/chore-session/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:ci-health-graph/ci-health-graph",
      "type": "skill",
      "slug": "ci-health-graph/ci-health-graph",
      "name": "ci-health-graph",
      "path": ".kody/executables/ci-health-graph/skills/ci-health-graph/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:classify/issue-classification",
      "type": "skill",
      "slug": "classify/issue-classification",
      "name": "issue-classification",
      "path": ".kody/executables/classify/skills/issue-classification/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:cleanup/cleanup-branches",
      "type": "skill",
      "slug": "cleanup/cleanup-branches",
      "name": "cleanup-branches",
      "path": ".kody/executables/cleanup/skills/cleanup-branches/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:cleanup/clear-empty-goals",
      "type": "skill",
      "slug": "cleanup/clear-empty-goals",
      "name": "clear-empty-goals",
      "path": ".kody/executables/cleanup/skills/clear-empty-goals/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:cleanup/dead-code-sweep",
      "type": "skill",
      "slug": "cleanup/dead-code-sweep",
      "name": "dead-code-sweep",
      "path": ".kody/executables/cleanup/skills/dead-code-sweep/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:cleanup/dependency-bump",
      "type": "skill",
      "slug": "cleanup/dependency-bump",
      "name": "dependency-bump",
      "path": ".kody/executables/cleanup/skills/dependency-bump/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:code-health/architecture-audit",
      "type": "skill",
      "slug": "code-health/architecture-audit",
      "name": "architecture-audit",
      "path": ".kody/executables/code-health/skills/architecture-audit/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:code-health/type-debt",
      "type": "skill",
      "slug": "code-health/type-debt",
      "name": "type-debt",
      "path": ".kody/executables/code-health/skills/type-debt/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:compact-memory/compact-memory",
      "type": "skill",
      "slug": "compact-memory/compact-memory",
      "name": "compact-memory",
      "path": ".kody/executables/compact-memory/skills/compact-memory/SKILL.md",
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
      "id": "skill:coverage-floor/coverage-floor",
      "type": "skill",
      "slug": "coverage-floor/coverage-floor",
      "name": "coverage-floor",
      "path": ".kody/executables/coverage-floor/skills/coverage-floor/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:dead-code-sweep/dead-code-sweep",
      "type": "skill",
      "slug": "dead-code-sweep/dead-code-sweep",
      "name": "dead-code-sweep",
      "path": ".kody/executables/dead-code-sweep/skills/dead-code-sweep/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:delivery-graph/ci-health-graph",
      "type": "skill",
      "slug": "delivery-graph/ci-health-graph",
      "name": "ci-health-graph",
      "path": ".kody/executables/delivery-graph/skills/ci-health-graph/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:delivery-graph/pr-graph",
      "type": "skill",
      "slug": "delivery-graph/pr-graph",
      "name": "pr-graph",
      "path": ".kody/executables/delivery-graph/skills/pr-graph/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:dependency-bump/dependency-bump",
      "type": "skill",
      "slug": "dependency-bump/dependency-bump",
      "name": "dependency-bump",
      "path": ".kody/executables/dependency-bump/skills/dependency-bump/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:dependency-graph/dependency-graph",
      "type": "skill",
      "slug": "dependency-graph/dependency-graph",
      "name": "dependency-graph",
      "path": ".kody/executables/dependency-graph/skills/dependency-graph/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:design-review/design-review",
      "type": "skill",
      "slug": "design-review/design-review",
      "name": "design-review",
      "path": ".kody/executables/design-review/skills/design-review/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:dev-ci-health/dev-ci-health",
      "type": "skill",
      "slug": "dev-ci-health/dev-ci-health",
      "name": "dev-ci-health",
      "path": ".kody/executables/dev-ci-health/skills/dev-ci-health/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:dev-ci-health/github-actions-docs",
      "type": "skill",
      "slug": "dev-ci-health/github-actions-docs",
      "name": "github-actions-docs",
      "path": ".kody/executables/dev-ci-health/skills/github-actions-docs/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:docs-code/docs-code",
      "type": "skill",
      "slug": "docs-code/docs-code",
      "name": "docs-code",
      "path": ".kody/executables/docs-code/skills/docs-code/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:docs-graph/docs-graph",
      "type": "skill",
      "slug": "docs-graph/docs-graph",
      "name": "docs-graph",
      "path": ".kody/executables/docs-graph/skills/docs-graph/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:docs-health/docs-code",
      "type": "skill",
      "slug": "docs-health/docs-code",
      "name": "docs-code",
      "path": ".kody/executables/docs-health/skills/docs-code/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:docs-health/docs-readme",
      "type": "skill",
      "slug": "docs-health/docs-readme",
      "name": "docs-readme",
      "path": ".kody/executables/docs-health/skills/docs-readme/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:docs-readme/docs-readme",
      "type": "skill",
      "slug": "docs-readme/docs-readme",
      "name": "docs-readme",
      "path": ".kody/executables/docs-readme/skills/docs-readme/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:duty-call/duty-call",
      "type": "skill",
      "slug": "duty-call/duty-call",
      "name": "duty-call",
      "path": ".kody/executables/duty-call/skills/duty-call/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:duty-review/duty-review",
      "type": "skill",
      "slug": "duty-review/duty-review",
      "name": "duty-review",
      "path": ".kody/executables/duty-review/skills/duty-review/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:extract-design-system/extract-design-system",
      "type": "skill",
      "slug": "extract-design-system/extract-design-system",
      "name": "extract-design-system",
      "path": ".kody/executables/extract-design-system/skills/extract-design-system/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:feature/design-system",
      "type": "skill",
      "slug": "feature/design-system",
      "name": "design-system",
      "path": ".kody/executables/feature/skills/design-system/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:feature/frontend-design",
      "type": "skill",
      "slug": "feature/frontend-design",
      "name": "frontend-design",
      "path": ".kody/executables/feature/skills/frontend-design/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:feature/implementation-session",
      "type": "skill",
      "slug": "feature/implementation-session",
      "name": "implementation-session",
      "path": ".kody/executables/feature/skills/implementation-session/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:feature/next-best-practices",
      "type": "skill",
      "slug": "feature/next-best-practices",
      "name": "next-best-practices",
      "path": ".kody/executables/feature/skills/next-best-practices/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:feature/shadcn",
      "type": "skill",
      "slug": "feature/shadcn",
      "name": "shadcn",
      "path": ".kody/executables/feature/skills/shadcn/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:feature/vercel-react-best-practices",
      "type": "skill",
      "slug": "feature/vercel-react-best-practices",
      "name": "vercel-react-best-practices",
      "path": ".kody/executables/feature/skills/vercel-react-best-practices/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:fix-ci/ci-repair",
      "type": "skill",
      "slug": "fix-ci/ci-repair",
      "name": "ci-repair",
      "path": ".kody/executables/fix-ci/skills/ci-repair/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:fix-ci/github-actions-docs",
      "type": "skill",
      "slug": "fix-ci/github-actions-docs",
      "name": "github-actions-docs",
      "path": ".kody/executables/fix-ci/skills/github-actions-docs/SKILL.md",
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
      "id": "skill:flaky-test-quarantine/flaky-test-quarantine",
      "type": "skill",
      "slug": "flaky-test-quarantine/flaky-test-quarantine",
      "name": "flaky-test-quarantine",
      "path": ".kody/executables/flaky-test-quarantine/skills/flaky-test-quarantine/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:health-check/health-check",
      "type": "skill",
      "slug": "health-check/health-check",
      "name": "health-check",
      "path": ".kody/executables/health-check/skills/health-check/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:plan/design-system",
      "type": "skill",
      "slug": "plan/design-system",
      "name": "design-system",
      "path": ".kody/executables/plan/skills/design-system/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:plan/frontend-design",
      "type": "skill",
      "slug": "plan/frontend-design",
      "name": "frontend-design",
      "path": ".kody/executables/plan/skills/frontend-design/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:plan/implementation-planning",
      "type": "skill",
      "slug": "plan/implementation-planning",
      "name": "implementation-planning",
      "path": ".kody/executables/plan/skills/implementation-planning/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:plan/next-best-practices",
      "type": "skill",
      "slug": "plan/next-best-practices",
      "name": "next-best-practices",
      "path": ".kody/executables/plan/skills/next-best-practices/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:plan/shadcn",
      "type": "skill",
      "slug": "plan/shadcn",
      "name": "shadcn",
      "path": ".kody/executables/plan/skills/shadcn/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:plan/vercel-react-best-practices",
      "type": "skill",
      "slug": "plan/vercel-react-best-practices",
      "name": "vercel-react-best-practices",
      "path": ".kody/executables/plan/skills/vercel-react-best-practices/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:pr-graph/pr-graph",
      "type": "skill",
      "slug": "pr-graph/pr-graph",
      "name": "pr-graph",
      "path": ".kody/executables/pr-graph/skills/pr-graph/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:pr-health-triage/pr-health-triage",
      "type": "skill",
      "slug": "pr-health-triage/pr-health-triage",
      "name": "pr-health-triage",
      "path": ".kody/executables/pr-health-triage/skills/pr-health-triage/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:qa-engineer/qa-session",
      "type": "skill",
      "slug": "qa-engineer/qa-session",
      "name": "qa-session",
      "path": ".kody/executables/qa-engineer/skills/qa-session/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:qa-engineer/webapp-testing",
      "type": "skill",
      "slug": "qa-engineer/webapp-testing",
      "name": "webapp-testing",
      "path": ".kody/executables/qa-engineer/skills/webapp-testing/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:qa-sweep/qa-sweep",
      "type": "skill",
      "slug": "qa-sweep/qa-sweep",
      "name": "qa-sweep",
      "path": ".kody/executables/qa-sweep/skills/qa-sweep/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:qa-verify/qa-verify",
      "type": "skill",
      "slug": "qa-verify/qa-verify",
      "name": "qa-verify",
      "path": ".kody/executables/qa-verify/skills/qa-verify/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:qa/qa",
      "type": "skill",
      "slug": "qa/qa",
      "name": "qa",
      "path": ".kody/executables/qa/skills/qa/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:quality-watch/coverage-floor",
      "type": "skill",
      "slug": "quality-watch/coverage-floor",
      "name": "coverage-floor",
      "path": ".kody/executables/quality-watch/skills/coverage-floor/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:quality-watch/flaky-test-quarantine",
      "type": "skill",
      "slug": "quality-watch/flaky-test-quarantine",
      "name": "flaky-test-quarantine",
      "path": ".kody/executables/quality-watch/skills/flaky-test-quarantine/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:quality-watch/security-audit",
      "type": "skill",
      "slug": "quality-watch/security-audit",
      "name": "security-audit",
      "path": ".kody/executables/quality-watch/skills/security-audit/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:redispatch/redispatch",
      "type": "skill",
      "slug": "redispatch/redispatch",
      "name": "redispatch",
      "path": ".kody/executables/redispatch/skills/redispatch/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:release/release-merge",
      "type": "skill",
      "slug": "release/release-merge",
      "name": "release-merge",
      "path": ".kody/executables/release/skills/release-merge/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:release/release-prepare",
      "type": "skill",
      "slug": "release/release-prepare",
      "name": "release-prepare",
      "path": ".kody/executables/release/skills/release-prepare/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:release/release-promote",
      "type": "skill",
      "slug": "release/release-promote",
      "name": "release-promote",
      "path": ".kody/executables/release/skills/release-promote/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:release/release-tag",
      "type": "skill",
      "slug": "release/release-tag",
      "name": "release-tag",
      "path": ".kody/executables/release/skills/release-tag/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:repo-graph/dependency-graph",
      "type": "skill",
      "slug": "repo-graph/dependency-graph",
      "name": "dependency-graph",
      "path": ".kody/executables/repo-graph/skills/dependency-graph/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:repo-graph/docs-graph",
      "type": "skill",
      "slug": "repo-graph/docs-graph",
      "name": "docs-graph",
      "path": ".kody/executables/repo-graph/skills/docs-graph/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:reproduce/bug-reproduction",
      "type": "skill",
      "slug": "reproduce/bug-reproduction",
      "name": "bug-reproduction",
      "path": ".kody/executables/reproduce/skills/bug-reproduction/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:research/issue-research",
      "type": "skill",
      "slug": "research/issue-research",
      "name": "issue-research",
      "path": ".kody/executables/research/skills/issue-research/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:review/code-review",
      "type": "skill",
      "slug": "review/code-review",
      "name": "code-review",
      "path": ".kody/executables/review/skills/code-review/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:review/design-system",
      "type": "skill",
      "slug": "review/design-system",
      "name": "design-system",
      "path": ".kody/executables/review/skills/design-system/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:review/next-best-practices",
      "type": "skill",
      "slug": "review/next-best-practices",
      "name": "next-best-practices",
      "path": ".kody/executables/review/skills/next-best-practices/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:review/vercel-react-best-practices",
      "type": "skill",
      "slug": "review/vercel-react-best-practices",
      "name": "vercel-react-best-practices",
      "path": ".kody/executables/review/skills/vercel-react-best-practices/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:review/web-design-guidelines",
      "type": "skill",
      "slug": "review/web-design-guidelines",
      "name": "web-design-guidelines",
      "path": ".kody/executables/review/skills/web-design-guidelines/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:security-audit/security-audit",
      "type": "skill",
      "slug": "security-audit/security-audit",
      "name": "security-audit",
      "path": ".kody/executables/security-audit/skills/security-audit/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:skills-research/skills-research",
      "type": "skill",
      "slug": "skills-research/skills-research",
      "name": "skills-research",
      "path": ".kody/executables/skills-research/skills/skills-research/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:system-audit/system-audit",
      "type": "skill",
      "slug": "system-audit/system-audit",
      "name": "system-audit",
      "path": ".kody/executables/system-audit/skills/system-audit/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:task-leader/task-leader-rules",
      "type": "skill",
      "slug": "task-leader/task-leader-rules",
      "name": "task-leader-rules",
      "path": ".kody/executables/task-leader/skills/task-leader-rules/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:task-memorize/task-memorize",
      "type": "skill",
      "slug": "task-memorize/task-memorize",
      "name": "task-memorize",
      "path": ".kody/executables/task-memorize/skills/task-memorize/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:task-verifier/verifier-method",
      "type": "skill",
      "slug": "task-verifier/verifier-method",
      "name": "verifier-method",
      "path": ".kody/executables/task-verifier/skills/verifier-method/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:type-debt/type-debt",
      "type": "skill",
      "slug": "type-debt/type-debt",
      "name": "type-debt",
      "path": ".kody/executables/type-debt/skills/type-debt/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:ui-review/design-system",
      "type": "skill",
      "slug": "ui-review/design-system",
      "name": "design-system",
      "path": ".kody/executables/ui-review/skills/design-system/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:ui-review/ui-review",
      "type": "skill",
      "slug": "ui-review/ui-review",
      "name": "ui-review",
      "path": ".kody/executables/ui-review/skills/ui-review/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:ui-review/web-design-guidelines",
      "type": "skill",
      "slug": "ui-review/web-design-guidelines",
      "name": "web-design-guidelines",
      "path": ".kody/executables/ui-review/skills/web-design-guidelines/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:ui-review/webapp-testing",
      "type": "skill",
      "slug": "ui-review/webapp-testing",
      "name": "webapp-testing",
      "path": ".kody/executables/ui-review/skills/webapp-testing/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:work-briefing/work-briefing",
      "type": "skill",
      "slug": "work-briefing/work-briefing",
      "name": "work-briefing",
      "path": ".kody/executables/work-briefing/skills/work-briefing/SKILL.md",
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
      "id": "context:ci-health-graph->audience->staff:ceo",
      "from": "context:ci-health-graph",
      "to": "staff:ceo",
      "relation": "audience"
    },
    {
      "id": "context:ci-health-graph->audience->staff:coo",
      "from": "context:ci-health-graph",
      "to": "staff:coo",
      "relation": "audience"
    },
    {
      "id": "context:ci-health-graph->audience->staff:cto",
      "from": "context:ci-health-graph",
      "to": "staff:cto",
      "relation": "audience"
    },
    {
      "id": "context:ci-health-graph->audience->staff:kody",
      "from": "context:ci-health-graph",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "context:ci-health-graph->audience->staff:qa",
      "from": "context:ci-health-graph",
      "to": "staff:qa",
      "relation": "audience"
    },
    {
      "id": "context:ci-health-graph->audience->staff:tech-writer",
      "from": "context:ci-health-graph",
      "to": "staff:tech-writer",
      "relation": "audience"
    },
    {
      "id": "context:ci-health-graph->audience->staff:ux-designer",
      "from": "context:ci-health-graph",
      "to": "staff:ux-designer",
      "relation": "audience"
    },
    {
      "id": "context:company-graph->audience->staff:ceo",
      "from": "context:company-graph",
      "to": "staff:ceo",
      "relation": "audience"
    },
    {
      "id": "context:company-graph->audience->staff:coo",
      "from": "context:company-graph",
      "to": "staff:coo",
      "relation": "audience"
    },
    {
      "id": "context:company-graph->audience->staff:cto",
      "from": "context:company-graph",
      "to": "staff:cto",
      "relation": "audience"
    },
    {
      "id": "context:company-graph->audience->staff:kody",
      "from": "context:company-graph",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "context:company-graph->audience->staff:qa",
      "from": "context:company-graph",
      "to": "staff:qa",
      "relation": "audience"
    },
    {
      "id": "context:company-graph->audience->staff:tech-writer",
      "from": "context:company-graph",
      "to": "staff:tech-writer",
      "relation": "audience"
    },
    {
      "id": "context:company-graph->audience->staff:ux-designer",
      "from": "context:company-graph",
      "to": "staff:ux-designer",
      "relation": "audience"
    },
    {
      "id": "context:dependency-graph->audience->staff:ceo",
      "from": "context:dependency-graph",
      "to": "staff:ceo",
      "relation": "audience"
    },
    {
      "id": "context:dependency-graph->audience->staff:coo",
      "from": "context:dependency-graph",
      "to": "staff:coo",
      "relation": "audience"
    },
    {
      "id": "context:dependency-graph->audience->staff:cto",
      "from": "context:dependency-graph",
      "to": "staff:cto",
      "relation": "audience"
    },
    {
      "id": "context:dependency-graph->audience->staff:kody",
      "from": "context:dependency-graph",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "context:dependency-graph->audience->staff:qa",
      "from": "context:dependency-graph",
      "to": "staff:qa",
      "relation": "audience"
    },
    {
      "id": "context:dependency-graph->audience->staff:tech-writer",
      "from": "context:dependency-graph",
      "to": "staff:tech-writer",
      "relation": "audience"
    },
    {
      "id": "context:dependency-graph->audience->staff:ux-designer",
      "from": "context:dependency-graph",
      "to": "staff:ux-designer",
      "relation": "audience"
    },
    {
      "id": "context:docs-graph->audience->staff:ceo",
      "from": "context:docs-graph",
      "to": "staff:ceo",
      "relation": "audience"
    },
    {
      "id": "context:docs-graph->audience->staff:coo",
      "from": "context:docs-graph",
      "to": "staff:coo",
      "relation": "audience"
    },
    {
      "id": "context:docs-graph->audience->staff:cto",
      "from": "context:docs-graph",
      "to": "staff:cto",
      "relation": "audience"
    },
    {
      "id": "context:docs-graph->audience->staff:kody",
      "from": "context:docs-graph",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "context:docs-graph->audience->staff:qa",
      "from": "context:docs-graph",
      "to": "staff:qa",
      "relation": "audience"
    },
    {
      "id": "context:docs-graph->audience->staff:tech-writer",
      "from": "context:docs-graph",
      "to": "staff:tech-writer",
      "relation": "audience"
    },
    {
      "id": "context:docs-graph->audience->staff:ux-designer",
      "from": "context:docs-graph",
      "to": "staff:ux-designer",
      "relation": "audience"
    },
    {
      "id": "context:ideas->audience->staff:kody",
      "from": "context:ideas",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "context:memory-compaction->audience->staff:ceo",
      "from": "context:memory-compaction",
      "to": "staff:ceo",
      "relation": "audience"
    },
    {
      "id": "context:memory-compaction->audience->staff:coo",
      "from": "context:memory-compaction",
      "to": "staff:coo",
      "relation": "audience"
    },
    {
      "id": "context:memory-compaction->audience->staff:cto",
      "from": "context:memory-compaction",
      "to": "staff:cto",
      "relation": "audience"
    },
    {
      "id": "context:memory-compaction->audience->staff:kody",
      "from": "context:memory-compaction",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "context:memory-compaction->audience->staff:qa",
      "from": "context:memory-compaction",
      "to": "staff:qa",
      "relation": "audience"
    },
    {
      "id": "context:memory-compaction->audience->staff:tech-writer",
      "from": "context:memory-compaction",
      "to": "staff:tech-writer",
      "relation": "audience"
    },
    {
      "id": "context:memory-compaction->audience->staff:ux-designer",
      "from": "context:memory-compaction",
      "to": "staff:ux-designer",
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
      "id": "context:pr-graph->audience->staff:ceo",
      "from": "context:pr-graph",
      "to": "staff:ceo",
      "relation": "audience"
    },
    {
      "id": "context:pr-graph->audience->staff:coo",
      "from": "context:pr-graph",
      "to": "staff:coo",
      "relation": "audience"
    },
    {
      "id": "context:pr-graph->audience->staff:cto",
      "from": "context:pr-graph",
      "to": "staff:cto",
      "relation": "audience"
    },
    {
      "id": "context:pr-graph->audience->staff:kody",
      "from": "context:pr-graph",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "context:pr-graph->audience->staff:qa",
      "from": "context:pr-graph",
      "to": "staff:qa",
      "relation": "audience"
    },
    {
      "id": "context:pr-graph->audience->staff:tech-writer",
      "from": "context:pr-graph",
      "to": "staff:tech-writer",
      "relation": "audience"
    },
    {
      "id": "context:pr-graph->audience->staff:ux-designer",
      "from": "context:pr-graph",
      "to": "staff:ux-designer",
      "relation": "audience"
    },
    {
      "id": "context:reports->audience->staff:ceo",
      "from": "context:reports",
      "to": "staff:ceo",
      "relation": "audience"
    },
    {
      "id": "context:reports->audience->staff:coo",
      "from": "context:reports",
      "to": "staff:coo",
      "relation": "audience"
    },
    {
      "id": "context:reports->audience->staff:cto",
      "from": "context:reports",
      "to": "staff:cto",
      "relation": "audience"
    },
    {
      "id": "context:reports->audience->staff:kody",
      "from": "context:reports",
      "to": "staff:kody",
      "relation": "audience"
    },
    {
      "id": "context:reports->audience->staff:qa",
      "from": "context:reports",
      "to": "staff:qa",
      "relation": "audience"
    },
    {
      "id": "context:reports->audience->staff:tech-writer",
      "from": "context:reports",
      "to": "staff:tech-writer",
      "relation": "audience"
    },
    {
      "id": "context:reports->audience->staff:ux-designer",
      "from": "context:reports",
      "to": "staff:ux-designer",
      "relation": "audience"
    },
    {
      "id": "duty:approval-gate->runs->executable:approval-gate",
      "from": "duty:approval-gate",
      "to": "executable:approval-gate",
      "relation": "runs"
    },
    {
      "id": "duty:bug->runs->executable:bug",
      "from": "duty:bug",
      "to": "executable:bug",
      "relation": "runs"
    },
    {
      "id": "duty:ceo-performance-review->runs->executable:ceo-performance-review",
      "from": "duty:ceo-performance-review",
      "to": "executable:ceo-performance-review",
      "relation": "runs"
    },
    {
      "id": "duty:chore->runs->executable:chore",
      "from": "duty:chore",
      "to": "executable:chore",
      "relation": "runs"
    },
    {
      "id": "duty:classify->runs->executable:classify",
      "from": "duty:classify",
      "to": "executable:classify",
      "relation": "runs"
    },
    {
      "id": "duty:cleanup->runs->executable:cleanup",
      "from": "duty:cleanup",
      "to": "executable:cleanup",
      "relation": "runs"
    },
    {
      "id": "duty:code-health->runs->executable:code-health",
      "from": "duty:code-health",
      "to": "executable:code-health",
      "relation": "runs"
    },
    {
      "id": "duty:company-graph->reads_from->context:company-graph",
      "from": "duty:company-graph",
      "to": "context:company-graph",
      "relation": "reads_from"
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
      "id": "duty:delivery-graph->reads_from->context:ci-health-graph",
      "from": "duty:delivery-graph",
      "to": "context:ci-health-graph",
      "relation": "reads_from"
    },
    {
      "id": "duty:delivery-graph->reads_from->context:pr-graph",
      "from": "duty:delivery-graph",
      "to": "context:pr-graph",
      "relation": "reads_from"
    },
    {
      "id": "duty:delivery-graph->runs->executable:delivery-graph",
      "from": "duty:delivery-graph",
      "to": "executable:delivery-graph",
      "relation": "runs"
    },
    {
      "id": "duty:delivery-graph->writes_to->report:ci-health-graph",
      "from": "duty:delivery-graph",
      "to": "report:ci-health-graph",
      "relation": "writes_to"
    },
    {
      "id": "duty:delivery-graph->writes_to->report:pr-graph",
      "from": "duty:delivery-graph",
      "to": "report:pr-graph",
      "relation": "writes_to"
    },
    {
      "id": "duty:design-review->runs->executable:design-review",
      "from": "duty:design-review",
      "to": "executable:design-review",
      "relation": "runs"
    },
    {
      "id": "duty:dev-ci-health->runs->executable:dev-ci-health",
      "from": "duty:dev-ci-health",
      "to": "executable:dev-ci-health",
      "relation": "runs"
    },
    {
      "id": "duty:docs-health->runs->executable:docs-health",
      "from": "duty:docs-health",
      "to": "executable:docs-health",
      "relation": "runs"
    },
    {
      "id": "duty:duty-call->runs->executable:duty-call",
      "from": "duty:duty-call",
      "to": "executable:duty-call",
      "relation": "runs"
    },
    {
      "id": "duty:duty-review->runs->executable:duty-review",
      "from": "duty:duty-review",
      "to": "executable:duty-review",
      "relation": "runs"
    },
    {
      "id": "duty:feature->runs->executable:feature",
      "from": "duty:feature",
      "to": "executable:feature",
      "relation": "runs"
    },
    {
      "id": "duty:fix->runs->executable:fix",
      "from": "duty:fix",
      "to": "executable:fix",
      "relation": "runs"
    },
    {
      "id": "duty:fix-ci->runs->executable:fix-ci",
      "from": "duty:fix-ci",
      "to": "executable:fix-ci",
      "relation": "runs"
    },
    {
      "id": "duty:health-check->runs->executable:health-check",
      "from": "duty:health-check",
      "to": "executable:health-check",
      "relation": "runs"
    },
    {
      "id": "duty:kody-analyzer->runs->executable:kody-chat",
      "from": "duty:kody-analyzer",
      "to": "executable:kody-chat",
      "relation": "runs"
    },
    {
      "id": "duty:kody-mem->runs->executable:kody-chat",
      "from": "duty:kody-mem",
      "to": "executable:kody-chat",
      "relation": "runs"
    },
    {
      "id": "duty:kody-operator->runs->executable:kody-chat",
      "from": "duty:kody-operator",
      "to": "executable:kody-chat",
      "relation": "runs"
    },
    {
      "id": "duty:kody-vibe->runs->executable:kody-chat",
      "from": "duty:kody-vibe",
      "to": "executable:kody-chat",
      "relation": "runs"
    },
    {
      "id": "duty:memory-compaction->reads_from->context:memory-compaction",
      "from": "duty:memory-compaction",
      "to": "context:memory-compaction",
      "relation": "reads_from"
    },
    {
      "id": "duty:memory-compaction->reads_from->context:reports",
      "from": "duty:memory-compaction",
      "to": "context:reports",
      "relation": "reads_from"
    },
    {
      "id": "duty:memory-compaction->runs->executable:compact-memory",
      "from": "duty:memory-compaction",
      "to": "executable:compact-memory",
      "relation": "runs"
    },
    {
      "id": "duty:memory-compaction->writes_to->report:memory-compaction",
      "from": "duty:memory-compaction",
      "to": "report:memory-compaction",
      "relation": "writes_to"
    },
    {
      "id": "duty:plan->runs->executable:plan",
      "from": "duty:plan",
      "to": "executable:plan",
      "relation": "runs"
    },
    {
      "id": "duty:pr-health-triage->runs->executable:pr-health-triage",
      "from": "duty:pr-health-triage",
      "to": "executable:pr-health-triage",
      "relation": "runs"
    },
    {
      "id": "duty:qa->runs->executable:qa",
      "from": "duty:qa",
      "to": "executable:qa",
      "relation": "runs"
    },
    {
      "id": "duty:qa-engineer->runs->executable:qa-engineer",
      "from": "duty:qa-engineer",
      "to": "executable:qa-engineer",
      "relation": "runs"
    },
    {
      "id": "duty:qa-sweep->runs->executable:qa-sweep",
      "from": "duty:qa-sweep",
      "to": "executable:qa-sweep",
      "relation": "runs"
    },
    {
      "id": "duty:qa-verify->runs->executable:qa-verify",
      "from": "duty:qa-verify",
      "to": "executable:qa-verify",
      "relation": "runs"
    },
    {
      "id": "duty:quality-watch->runs->executable:quality-watch",
      "from": "duty:quality-watch",
      "to": "executable:quality-watch",
      "relation": "runs"
    },
    {
      "id": "duty:redispatch->runs->executable:redispatch",
      "from": "duty:redispatch",
      "to": "executable:redispatch",
      "relation": "runs"
    },
    {
      "id": "duty:release->assigned_to->staff:kody",
      "from": "duty:release",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:release->runs->executable:release",
      "from": "duty:release",
      "to": "executable:release",
      "relation": "runs"
    },
    {
      "id": "duty:repo-graph->reads_from->context:dependency-graph",
      "from": "duty:repo-graph",
      "to": "context:dependency-graph",
      "relation": "reads_from"
    },
    {
      "id": "duty:repo-graph->reads_from->context:docs-graph",
      "from": "duty:repo-graph",
      "to": "context:docs-graph",
      "relation": "reads_from"
    },
    {
      "id": "duty:repo-graph->runs->executable:repo-graph",
      "from": "duty:repo-graph",
      "to": "executable:repo-graph",
      "relation": "runs"
    },
    {
      "id": "duty:repo-graph->writes_to->report:dependency-graph",
      "from": "duty:repo-graph",
      "to": "report:dependency-graph",
      "relation": "writes_to"
    },
    {
      "id": "duty:repo-graph->writes_to->report:docs-graph",
      "from": "duty:repo-graph",
      "to": "report:docs-graph",
      "relation": "writes_to"
    },
    {
      "id": "duty:reproduce->runs->executable:reproduce",
      "from": "duty:reproduce",
      "to": "executable:reproduce",
      "relation": "runs"
    },
    {
      "id": "duty:research->runs->executable:research",
      "from": "duty:research",
      "to": "executable:research",
      "relation": "runs"
    },
    {
      "id": "duty:resolve->runs->executable:resolve",
      "from": "duty:resolve",
      "to": "executable:resolve",
      "relation": "runs"
    },
    {
      "id": "duty:revert->runs->executable:revert",
      "from": "duty:revert",
      "to": "executable:revert",
      "relation": "runs"
    },
    {
      "id": "duty:review->runs->executable:review",
      "from": "duty:review",
      "to": "executable:review",
      "relation": "runs"
    },
    {
      "id": "duty:skills-research->runs->executable:skills-research",
      "from": "duty:skills-research",
      "to": "executable:skills-research",
      "relation": "runs"
    },
    {
      "id": "duty:spec->runs->executable:spec",
      "from": "duty:spec",
      "to": "executable:spec",
      "relation": "runs"
    },
    {
      "id": "duty:sync->runs->executable:sync",
      "from": "duty:sync",
      "to": "executable:sync",
      "relation": "runs"
    },
    {
      "id": "duty:system-audit->runs->executable:system-audit",
      "from": "duty:system-audit",
      "to": "executable:system-audit",
      "relation": "runs"
    },
    {
      "id": "duty:task-leader->assigned_to->staff:kody",
      "from": "duty:task-leader",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:task-leader->runs->executable:task-leader",
      "from": "duty:task-leader",
      "to": "executable:task-leader",
      "relation": "runs"
    },
    {
      "id": "duty:task-memorize->runs->executable:task-memorize",
      "from": "duty:task-memorize",
      "to": "executable:task-memorize",
      "relation": "runs"
    },
    {
      "id": "duty:task-verifier->assigned_to->staff:kody",
      "from": "duty:task-verifier",
      "to": "staff:kody",
      "relation": "assigned_to"
    },
    {
      "id": "duty:task-verifier->runs->executable:task-verifier",
      "from": "duty:task-verifier",
      "to": "executable:task-verifier",
      "relation": "runs"
    },
    {
      "id": "duty:ui-review->runs->executable:ui-review",
      "from": "duty:ui-review",
      "to": "executable:ui-review",
      "relation": "runs"
    },
    {
      "id": "duty:vercel-dev-deploy->runs->executable:vercel-dev-deploy",
      "from": "duty:vercel-dev-deploy",
      "to": "executable:vercel-dev-deploy",
      "relation": "runs"
    },
    {
      "id": "duty:vercel-production-deploy->runs->executable:vercel-production-deploy",
      "from": "duty:vercel-production-deploy",
      "to": "executable:vercel-production-deploy",
      "relation": "runs"
    },
    {
      "id": "duty:work-briefing->runs->executable:work-briefing",
      "from": "duty:work-briefing",
      "to": "executable:work-briefing",
      "relation": "runs"
    },
    {
      "id": "executable:approval-gate->uses_skill->skill:approval-gate/approval-gate",
      "from": "executable:approval-gate",
      "to": "skill:approval-gate/approval-gate",
      "relation": "uses_skill"
    },
    {
      "id": "executable:architecture-audit->uses_skill->skill:architecture-audit/architecture-audit",
      "from": "executable:architecture-audit",
      "to": "skill:architecture-audit/architecture-audit",
      "relation": "uses_skill"
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
      "id": "executable:ceo-performance-review->uses_skill->skill:ceo-performance-review/ceo-performance-review",
      "from": "executable:ceo-performance-review",
      "to": "skill:ceo-performance-review/ceo-performance-review",
      "relation": "uses_skill"
    },
    {
      "id": "executable:chore->uses_skill->skill:chore/chore-session",
      "from": "executable:chore",
      "to": "skill:chore/chore-session",
      "relation": "uses_skill"
    },
    {
      "id": "executable:ci-health-graph->runs_preflight->script:ci-health-graph/refresh-ci-health-graph.sh",
      "from": "executable:ci-health-graph",
      "to": "script:ci-health-graph/refresh-ci-health-graph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:ci-health-graph->uses_skill->skill:ci-health-graph/ci-health-graph",
      "from": "executable:ci-health-graph",
      "to": "skill:ci-health-graph/ci-health-graph",
      "relation": "uses_skill"
    },
    {
      "id": "executable:classify->uses_skill->skill:classify/issue-classification",
      "from": "executable:classify",
      "to": "skill:classify/issue-classification",
      "relation": "uses_skill"
    },
    {
      "id": "executable:cleanup->uses_skill->skill:cleanup/cleanup-branches",
      "from": "executable:cleanup",
      "to": "skill:cleanup/cleanup-branches",
      "relation": "uses_skill"
    },
    {
      "id": "executable:cleanup->uses_skill->skill:cleanup/clear-empty-goals",
      "from": "executable:cleanup",
      "to": "skill:cleanup/clear-empty-goals",
      "relation": "uses_skill"
    },
    {
      "id": "executable:cleanup->uses_skill->skill:cleanup/dead-code-sweep",
      "from": "executable:cleanup",
      "to": "skill:cleanup/dead-code-sweep",
      "relation": "uses_skill"
    },
    {
      "id": "executable:cleanup->uses_skill->skill:cleanup/dependency-bump",
      "from": "executable:cleanup",
      "to": "skill:cleanup/dependency-bump",
      "relation": "uses_skill"
    },
    {
      "id": "executable:code-health->uses_skill->skill:code-health/architecture-audit",
      "from": "executable:code-health",
      "to": "skill:code-health/architecture-audit",
      "relation": "uses_skill"
    },
    {
      "id": "executable:code-health->uses_skill->skill:code-health/type-debt",
      "from": "executable:code-health",
      "to": "skill:code-health/type-debt",
      "relation": "uses_skill"
    },
    {
      "id": "executable:compact-memory->runs_preflight->script:compact-memory/refresh-memory-compaction.sh",
      "from": "executable:compact-memory",
      "to": "script:compact-memory/refresh-memory-compaction.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:compact-memory->uses_skill->skill:compact-memory/compact-memory",
      "from": "executable:compact-memory",
      "to": "skill:compact-memory/compact-memory",
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
      "id": "executable:coverage-floor->uses_skill->skill:coverage-floor/coverage-floor",
      "from": "executable:coverage-floor",
      "to": "skill:coverage-floor/coverage-floor",
      "relation": "uses_skill"
    },
    {
      "id": "executable:dead-code-sweep->uses_skill->skill:dead-code-sweep/dead-code-sweep",
      "from": "executable:dead-code-sweep",
      "to": "skill:dead-code-sweep/dead-code-sweep",
      "relation": "uses_skill"
    },
    {
      "id": "executable:delivery-graph->runs_preflight->script:delivery-graph/refresh-delivery-graphs.sh",
      "from": "executable:delivery-graph",
      "to": "script:delivery-graph/refresh-delivery-graphs.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:delivery-graph->uses_skill->skill:delivery-graph/ci-health-graph",
      "from": "executable:delivery-graph",
      "to": "skill:delivery-graph/ci-health-graph",
      "relation": "uses_skill"
    },
    {
      "id": "executable:delivery-graph->uses_skill->skill:delivery-graph/pr-graph",
      "from": "executable:delivery-graph",
      "to": "skill:delivery-graph/pr-graph",
      "relation": "uses_skill"
    },
    {
      "id": "executable:dependency-bump->uses_skill->skill:dependency-bump/dependency-bump",
      "from": "executable:dependency-bump",
      "to": "skill:dependency-bump/dependency-bump",
      "relation": "uses_skill"
    },
    {
      "id": "executable:dependency-graph->runs_preflight->script:dependency-graph/refresh-dependency-graph.sh",
      "from": "executable:dependency-graph",
      "to": "script:dependency-graph/refresh-dependency-graph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:dependency-graph->uses_skill->skill:dependency-graph/dependency-graph",
      "from": "executable:dependency-graph",
      "to": "skill:dependency-graph/dependency-graph",
      "relation": "uses_skill"
    },
    {
      "id": "executable:design-review->uses_skill->skill:design-review/design-review",
      "from": "executable:design-review",
      "to": "skill:design-review/design-review",
      "relation": "uses_skill"
    },
    {
      "id": "executable:dev-ci-health->uses_skill->skill:dev-ci-health/dev-ci-health",
      "from": "executable:dev-ci-health",
      "to": "skill:dev-ci-health/dev-ci-health",
      "relation": "uses_skill"
    },
    {
      "id": "executable:dev-ci-health->uses_skill->skill:dev-ci-health/github-actions-docs",
      "from": "executable:dev-ci-health",
      "to": "skill:dev-ci-health/github-actions-docs",
      "relation": "uses_skill"
    },
    {
      "id": "executable:docs-code->uses_skill->skill:docs-code/docs-code",
      "from": "executable:docs-code",
      "to": "skill:docs-code/docs-code",
      "relation": "uses_skill"
    },
    {
      "id": "executable:docs-graph->runs_preflight->script:docs-graph/refresh-docs-graph.sh",
      "from": "executable:docs-graph",
      "to": "script:docs-graph/refresh-docs-graph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:docs-graph->uses_skill->skill:docs-graph/docs-graph",
      "from": "executable:docs-graph",
      "to": "skill:docs-graph/docs-graph",
      "relation": "uses_skill"
    },
    {
      "id": "executable:docs-health->uses_skill->skill:docs-health/docs-code",
      "from": "executable:docs-health",
      "to": "skill:docs-health/docs-code",
      "relation": "uses_skill"
    },
    {
      "id": "executable:docs-health->uses_skill->skill:docs-health/docs-readme",
      "from": "executable:docs-health",
      "to": "skill:docs-health/docs-readme",
      "relation": "uses_skill"
    },
    {
      "id": "executable:docs-readme->uses_skill->skill:docs-readme/docs-readme",
      "from": "executable:docs-readme",
      "to": "skill:docs-readme/docs-readme",
      "relation": "uses_skill"
    },
    {
      "id": "executable:duty-call->uses_skill->skill:duty-call/duty-call",
      "from": "executable:duty-call",
      "to": "skill:duty-call/duty-call",
      "relation": "uses_skill"
    },
    {
      "id": "executable:duty-review->uses_skill->skill:duty-review/duty-review",
      "from": "executable:duty-review",
      "to": "skill:duty-review/duty-review",
      "relation": "uses_skill"
    },
    {
      "id": "executable:extract-design-system->uses_skill->skill:extract-design-system/extract-design-system",
      "from": "executable:extract-design-system",
      "to": "skill:extract-design-system/extract-design-system",
      "relation": "uses_skill"
    },
    {
      "id": "executable:feature->runs_preflight->script:feature/install-codegraph.sh",
      "from": "executable:feature",
      "to": "script:feature/install-codegraph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:feature->uses_skill->skill:feature/design-system",
      "from": "executable:feature",
      "to": "skill:feature/design-system",
      "relation": "uses_skill"
    },
    {
      "id": "executable:feature->uses_skill->skill:feature/frontend-design",
      "from": "executable:feature",
      "to": "skill:feature/frontend-design",
      "relation": "uses_skill"
    },
    {
      "id": "executable:feature->uses_skill->skill:feature/implementation-session",
      "from": "executable:feature",
      "to": "skill:feature/implementation-session",
      "relation": "uses_skill"
    },
    {
      "id": "executable:feature->uses_skill->skill:feature/next-best-practices",
      "from": "executable:feature",
      "to": "skill:feature/next-best-practices",
      "relation": "uses_skill"
    },
    {
      "id": "executable:feature->uses_skill->skill:feature/shadcn",
      "from": "executable:feature",
      "to": "skill:feature/shadcn",
      "relation": "uses_skill"
    },
    {
      "id": "executable:feature->uses_skill->skill:feature/vercel-react-best-practices",
      "from": "executable:feature",
      "to": "skill:feature/vercel-react-best-practices",
      "relation": "uses_skill"
    },
    {
      "id": "executable:fix->uses_skill->skill:fix/feedback-application",
      "from": "executable:fix",
      "to": "skill:fix/feedback-application",
      "relation": "uses_skill"
    },
    {
      "id": "executable:fix-ci->uses_skill->skill:fix-ci/ci-repair",
      "from": "executable:fix-ci",
      "to": "skill:fix-ci/ci-repair",
      "relation": "uses_skill"
    },
    {
      "id": "executable:fix-ci->uses_skill->skill:fix-ci/github-actions-docs",
      "from": "executable:fix-ci",
      "to": "skill:fix-ci/github-actions-docs",
      "relation": "uses_skill"
    },
    {
      "id": "executable:flaky-test-quarantine->uses_skill->skill:flaky-test-quarantine/flaky-test-quarantine",
      "from": "executable:flaky-test-quarantine",
      "to": "skill:flaky-test-quarantine/flaky-test-quarantine",
      "relation": "uses_skill"
    },
    {
      "id": "executable:health-check->uses_skill->skill:health-check/health-check",
      "from": "executable:health-check",
      "to": "skill:health-check/health-check",
      "relation": "uses_skill"
    },
    {
      "id": "executable:plan->runs_preflight->script:plan/install-codegraph.sh",
      "from": "executable:plan",
      "to": "script:plan/install-codegraph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:plan->uses_skill->skill:plan/design-system",
      "from": "executable:plan",
      "to": "skill:plan/design-system",
      "relation": "uses_skill"
    },
    {
      "id": "executable:plan->uses_skill->skill:plan/frontend-design",
      "from": "executable:plan",
      "to": "skill:plan/frontend-design",
      "relation": "uses_skill"
    },
    {
      "id": "executable:plan->uses_skill->skill:plan/implementation-planning",
      "from": "executable:plan",
      "to": "skill:plan/implementation-planning",
      "relation": "uses_skill"
    },
    {
      "id": "executable:plan->uses_skill->skill:plan/next-best-practices",
      "from": "executable:plan",
      "to": "skill:plan/next-best-practices",
      "relation": "uses_skill"
    },
    {
      "id": "executable:plan->uses_skill->skill:plan/shadcn",
      "from": "executable:plan",
      "to": "skill:plan/shadcn",
      "relation": "uses_skill"
    },
    {
      "id": "executable:plan->uses_skill->skill:plan/vercel-react-best-practices",
      "from": "executable:plan",
      "to": "skill:plan/vercel-react-best-practices",
      "relation": "uses_skill"
    },
    {
      "id": "executable:pr-graph->runs_preflight->script:pr-graph/refresh-pr-graph.sh",
      "from": "executable:pr-graph",
      "to": "script:pr-graph/refresh-pr-graph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:pr-graph->uses_skill->skill:pr-graph/pr-graph",
      "from": "executable:pr-graph",
      "to": "skill:pr-graph/pr-graph",
      "relation": "uses_skill"
    },
    {
      "id": "executable:pr-health-triage->uses_skill->skill:pr-health-triage/pr-health-triage",
      "from": "executable:pr-health-triage",
      "to": "skill:pr-health-triage/pr-health-triage",
      "relation": "uses_skill"
    },
    {
      "id": "executable:qa->uses_skill->skill:qa/qa",
      "from": "executable:qa",
      "to": "skill:qa/qa",
      "relation": "uses_skill"
    },
    {
      "id": "executable:qa-engineer->uses_skill->skill:qa-engineer/qa-session",
      "from": "executable:qa-engineer",
      "to": "skill:qa-engineer/qa-session",
      "relation": "uses_skill"
    },
    {
      "id": "executable:qa-engineer->uses_skill->skill:qa-engineer/webapp-testing",
      "from": "executable:qa-engineer",
      "to": "skill:qa-engineer/webapp-testing",
      "relation": "uses_skill"
    },
    {
      "id": "executable:qa-sweep->uses_skill->skill:qa-sweep/qa-sweep",
      "from": "executable:qa-sweep",
      "to": "skill:qa-sweep/qa-sweep",
      "relation": "uses_skill"
    },
    {
      "id": "executable:qa-verify->uses_skill->skill:qa-verify/qa-verify",
      "from": "executable:qa-verify",
      "to": "skill:qa-verify/qa-verify",
      "relation": "uses_skill"
    },
    {
      "id": "executable:quality-watch->uses_skill->skill:quality-watch/coverage-floor",
      "from": "executable:quality-watch",
      "to": "skill:quality-watch/coverage-floor",
      "relation": "uses_skill"
    },
    {
      "id": "executable:quality-watch->uses_skill->skill:quality-watch/flaky-test-quarantine",
      "from": "executable:quality-watch",
      "to": "skill:quality-watch/flaky-test-quarantine",
      "relation": "uses_skill"
    },
    {
      "id": "executable:quality-watch->uses_skill->skill:quality-watch/security-audit",
      "from": "executable:quality-watch",
      "to": "skill:quality-watch/security-audit",
      "relation": "uses_skill"
    },
    {
      "id": "executable:redispatch->uses_skill->skill:redispatch/redispatch",
      "from": "executable:redispatch",
      "to": "skill:redispatch/redispatch",
      "relation": "uses_skill"
    },
    {
      "id": "executable:release->uses_skill->skill:release/release-merge",
      "from": "executable:release",
      "to": "skill:release/release-merge",
      "relation": "uses_skill"
    },
    {
      "id": "executable:release->uses_skill->skill:release/release-prepare",
      "from": "executable:release",
      "to": "skill:release/release-prepare",
      "relation": "uses_skill"
    },
    {
      "id": "executable:release->uses_skill->skill:release/release-promote",
      "from": "executable:release",
      "to": "skill:release/release-promote",
      "relation": "uses_skill"
    },
    {
      "id": "executable:release->uses_skill->skill:release/release-tag",
      "from": "executable:release",
      "to": "skill:release/release-tag",
      "relation": "uses_skill"
    },
    {
      "id": "executable:repo-graph->runs_preflight->script:repo-graph/refresh-repo-graphs.sh",
      "from": "executable:repo-graph",
      "to": "script:repo-graph/refresh-repo-graphs.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:repo-graph->uses_skill->skill:repo-graph/dependency-graph",
      "from": "executable:repo-graph",
      "to": "skill:repo-graph/dependency-graph",
      "relation": "uses_skill"
    },
    {
      "id": "executable:repo-graph->uses_skill->skill:repo-graph/docs-graph",
      "from": "executable:repo-graph",
      "to": "skill:repo-graph/docs-graph",
      "relation": "uses_skill"
    },
    {
      "id": "executable:reproduce->uses_skill->skill:reproduce/bug-reproduction",
      "from": "executable:reproduce",
      "to": "skill:reproduce/bug-reproduction",
      "relation": "uses_skill"
    },
    {
      "id": "executable:research->runs_preflight->script:research/install-codegraph.sh",
      "from": "executable:research",
      "to": "script:research/install-codegraph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:research->uses_skill->skill:research/issue-research",
      "from": "executable:research",
      "to": "skill:research/issue-research",
      "relation": "uses_skill"
    },
    {
      "id": "executable:review->runs_preflight->script:review/install-codegraph.sh",
      "from": "executable:review",
      "to": "script:review/install-codegraph.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:review->uses_skill->skill:review/code-review",
      "from": "executable:review",
      "to": "skill:review/code-review",
      "relation": "uses_skill"
    },
    {
      "id": "executable:review->uses_skill->skill:review/design-system",
      "from": "executable:review",
      "to": "skill:review/design-system",
      "relation": "uses_skill"
    },
    {
      "id": "executable:review->uses_skill->skill:review/next-best-practices",
      "from": "executable:review",
      "to": "skill:review/next-best-practices",
      "relation": "uses_skill"
    },
    {
      "id": "executable:review->uses_skill->skill:review/vercel-react-best-practices",
      "from": "executable:review",
      "to": "skill:review/vercel-react-best-practices",
      "relation": "uses_skill"
    },
    {
      "id": "executable:review->uses_skill->skill:review/web-design-guidelines",
      "from": "executable:review",
      "to": "skill:review/web-design-guidelines",
      "relation": "uses_skill"
    },
    {
      "id": "executable:security-audit->uses_skill->skill:security-audit/security-audit",
      "from": "executable:security-audit",
      "to": "skill:security-audit/security-audit",
      "relation": "uses_skill"
    },
    {
      "id": "executable:skills-research->uses_skill->skill:skills-research/skills-research",
      "from": "executable:skills-research",
      "to": "skill:skills-research/skills-research",
      "relation": "uses_skill"
    },
    {
      "id": "executable:system-audit->uses_skill->skill:system-audit/system-audit",
      "from": "executable:system-audit",
      "to": "skill:system-audit/system-audit",
      "relation": "uses_skill"
    },
    {
      "id": "executable:task-leader->uses_skill->skill:task-leader/task-leader-rules",
      "from": "executable:task-leader",
      "to": "skill:task-leader/task-leader-rules",
      "relation": "uses_skill"
    },
    {
      "id": "executable:task-memorize->uses_skill->skill:task-memorize/task-memorize",
      "from": "executable:task-memorize",
      "to": "skill:task-memorize/task-memorize",
      "relation": "uses_skill"
    },
    {
      "id": "executable:task-verifier->uses_skill->skill:task-verifier/verifier-method",
      "from": "executable:task-verifier",
      "to": "skill:task-verifier/verifier-method",
      "relation": "uses_skill"
    },
    {
      "id": "executable:type-debt->uses_skill->skill:type-debt/type-debt",
      "from": "executable:type-debt",
      "to": "skill:type-debt/type-debt",
      "relation": "uses_skill"
    },
    {
      "id": "executable:ui-review->uses_skill->skill:ui-review/design-system",
      "from": "executable:ui-review",
      "to": "skill:ui-review/design-system",
      "relation": "uses_skill"
    },
    {
      "id": "executable:ui-review->uses_skill->skill:ui-review/ui-review",
      "from": "executable:ui-review",
      "to": "skill:ui-review/ui-review",
      "relation": "uses_skill"
    },
    {
      "id": "executable:ui-review->uses_skill->skill:ui-review/web-design-guidelines",
      "from": "executable:ui-review",
      "to": "skill:ui-review/web-design-guidelines",
      "relation": "uses_skill"
    },
    {
      "id": "executable:ui-review->uses_skill->skill:ui-review/webapp-testing",
      "from": "executable:ui-review",
      "to": "skill:ui-review/webapp-testing",
      "relation": "uses_skill"
    },
    {
      "id": "executable:vercel-dev-deploy->runs_preflight->script:vercel-dev-deploy/vercel-dev-deploy.sh",
      "from": "executable:vercel-dev-deploy",
      "to": "script:vercel-dev-deploy/vercel-dev-deploy.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:vercel-production-deploy->runs_preflight->script:vercel-production-deploy/vercel-production-deploy.sh",
      "from": "executable:vercel-production-deploy",
      "to": "script:vercel-production-deploy/vercel-production-deploy.sh",
      "relation": "runs_preflight"
    },
    {
      "id": "executable:work-briefing->uses_skill->skill:work-briefing/work-briefing",
      "from": "executable:work-briefing",
      "to": "skill:work-briefing/work-briefing",
      "relation": "uses_skill"
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
    "goals",
    "memory",
    "runs",
    "sessions",
    "tasks",
    "terminal"
  ]
}
```
