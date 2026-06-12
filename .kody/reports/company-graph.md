---
slug: company-graph
dutySlug: company-graph
generatedAt: "2026-06-12T15:22:18Z"
findings:
  - id: company-graph.snapshot
    severity: low
    title: "Graph snapshot emitted"
    data: {"nodeCounts":{"context":11,"duties":36,"staff":7,"executables":49,"scripts":12,"skills":68,"reports":10,"goals":2,"issues":13},"graphHash":"4c7ec4af30efd8771d5eca7923caf4f84cdcd35442ad69ec69a3885c7f98ae32"}
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
---

# Company Graph

| Node type | Count |
|---|---:|
| context | 11 |
| duties | 36 |
| staff | 7 |
| executables | 49 |
| scripts | 12 |
| skills | 68 |
| reports | 10 |
| goals | 2 |
| issues | 13 |

Graph hash: `4c7ec4af30efd8771d5eca7923caf4f84cdcd35442ad69ec69a3885c7f98ae32`

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
      "staff": "cto",
      "executables": [
        "approval-gate"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:architecture-audit",
      "type": "duty",
      "slug": "architecture-audit",
      "staff": "cto",
      "executables": [
        "architecture-audit"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:ceo-performance-review",
      "type": "duty",
      "slug": "ceo-performance-review",
      "staff": "ceo",
      "executables": [
        "ceo-performance-review"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:ci-health-graph",
      "type": "duty",
      "slug": "ci-health-graph",
      "staff": "qa",
      "executables": [
        "ci-health-graph"
      ],
      "readsFrom": [
        "ci-health-graph"
      ],
      "writesTo": [
        "ci-health-graph"
      ],
      "disabled": false
    },
    {
      "id": "duty:cleanup-branches",
      "type": "duty",
      "slug": "cleanup-branches",
      "staff": "coo",
      "executables": [
        "cleanup-branches"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:clear-empty-goals",
      "type": "duty",
      "slug": "clear-empty-goals",
      "staff": "coo",
      "executables": [
        "clear-empty-goals"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
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
        "company-graph",
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
      "staff": "cto",
      "executables": [
        "coverage-floor"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:dead-code-sweep",
      "type": "duty",
      "slug": "dead-code-sweep",
      "staff": "coo",
      "executables": [
        "dead-code-sweep"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:dependency-bump",
      "type": "duty",
      "slug": "dependency-bump",
      "staff": "coo",
      "executables": [
        "dependency-bump"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:dependency-graph",
      "type": "duty",
      "slug": "dependency-graph",
      "staff": "cto",
      "executables": [
        "dependency-graph"
      ],
      "readsFrom": [
        "dependency-graph"
      ],
      "writesTo": [
        "dependency-graph"
      ],
      "disabled": false
    },
    {
      "id": "duty:design-review",
      "type": "duty",
      "slug": "design-review",
      "staff": "ux-designer",
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
      "staff": "cto",
      "executables": [
        "dev-ci-health"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:docs-code",
      "type": "duty",
      "slug": "docs-code",
      "staff": "tech-writer",
      "executables": [
        "docs-code"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:docs-graph",
      "type": "duty",
      "slug": "docs-graph",
      "staff": "tech-writer",
      "executables": [
        "docs-graph"
      ],
      "readsFrom": [
        "docs-graph"
      ],
      "writesTo": [
        "docs-graph"
      ],
      "disabled": false
    },
    {
      "id": "duty:docs-readme",
      "type": "duty",
      "slug": "docs-readme",
      "staff": "tech-writer",
      "executables": [
        "docs-readme"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:duty-call",
      "type": "duty",
      "slug": "duty-call",
      "staff": "ceo",
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
      "staff": "coo",
      "executables": [
        "duty-review"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:flaky-test-quarantine",
      "type": "duty",
      "slug": "flaky-test-quarantine",
      "staff": "cto",
      "executables": [
        "flaky-test-quarantine"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:health-check",
      "type": "duty",
      "slug": "health-check",
      "staff": "coo",
      "executables": [
        "health-check"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:inbox-ping",
      "type": "duty",
      "slug": "inbox-ping",
      "staff": "coo",
      "executables": [
        "inbox-ping"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:memory-compaction",
      "type": "duty",
      "slug": "memory-compaction",
      "staff": "coo",
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
      "id": "duty:pr-graph",
      "type": "duty",
      "slug": "pr-graph",
      "staff": "coo",
      "executables": [
        "pr-graph"
      ],
      "readsFrom": [
        "pr-graph"
      ],
      "writesTo": [
        "pr-graph"
      ],
      "disabled": false
    },
    {
      "id": "duty:pr-health-triage",
      "type": "duty",
      "slug": "pr-health-triage",
      "staff": "cto",
      "executables": [
        "pr-health-triage"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:publish-release",
      "type": "duty",
      "slug": "publish-release",
      "staff": "coo",
      "executables": [
        "publish-release"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:qa",
      "type": "duty",
      "slug": "qa",
      "staff": "qa",
      "executables": [
        "qa"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:qa-sweep",
      "type": "duty",
      "slug": "qa-sweep",
      "staff": "qa",
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
      "staff": "qa",
      "executables": [
        "qa-verify"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:redispatch",
      "type": "duty",
      "slug": "redispatch",
      "staff": "coo",
      "executables": [
        "redispatch"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:security-audit",
      "type": "duty",
      "slug": "security-audit",
      "staff": "cto",
      "executables": [
        "security-audit"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:skills-research",
      "type": "duty",
      "slug": "skills-research",
      "staff": "cto",
      "executables": [
        "skills-research"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:system-audit",
      "type": "duty",
      "slug": "system-audit",
      "staff": "coo",
      "executables": [
        "system-audit"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:task-memorize",
      "type": "duty",
      "slug": "task-memorize",
      "staff": "coo",
      "executables": [
        "task-memorize"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:test-ex",
      "type": "duty",
      "slug": "test-ex",
      "staff": "",
      "executables": [],
      "readsFrom": [],
      "writesTo": [],
      "disabled": false
    },
    {
      "id": "duty:type-debt",
      "type": "duty",
      "slug": "type-debt",
      "staff": "cto",
      "executables": [
        "type-debt"
      ],
      "readsFrom": [],
      "writesTo": [],
      "disabled": true
    },
    {
      "id": "duty:work-briefing",
      "type": "duty",
      "slug": "work-briefing",
      "staff": "coo",
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
      "id": "executable:cleanup-branches",
      "type": "executable",
      "slug": "cleanup-branches",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Delete stale task branches whose linked task is closed, done, or failed.",
      "skills": [
        "cleanup-branches"
      ],
      "shellScripts": []
    },
    {
      "id": "executable:clear-empty-goals",
      "type": "executable",
      "slug": "clear-empty-goals",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Find goals that contain no tasks and remove or report them according to the executable method.",
      "skills": [
        "clear-empty-goals"
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
      "id": "executable:inbox-ping",
      "type": "executable",
      "slug": "inbox-ping",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Post a heartbeat recommendation proving that duty mentions reach the dashboard inbox.",
      "skills": [
        "inbox-ping"
      ],
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
      "id": "executable:publish-release",
      "type": "executable",
      "slug": "publish-release",
      "role": "primitive",
      "kind": "oneshot",
      "staff": "",
      "describe": "Create a release-request issue and dispatch the release orchestrator on demand.",
      "skills": [
        "publish-release"
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
      "id": "skill:cleanup-branches/cleanup-branches",
      "type": "skill",
      "slug": "cleanup-branches/cleanup-branches",
      "name": "cleanup-branches",
      "path": ".kody/executables/cleanup-branches/skills/cleanup-branches/SKILL.md",
      "scope": "executable"
    },
    {
      "id": "skill:clear-empty-goals/clear-empty-goals",
      "type": "skill",
      "slug": "clear-empty-goals/clear-empty-goals",
      "name": "clear-empty-goals",
      "path": ".kody/executables/clear-empty-goals/skills/clear-empty-goals/SKILL.md",
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
      "id": "skill:inbox-ping/inbox-ping",
      "type": "skill",
      "slug": "inbox-ping/inbox-ping",
      "name": "inbox-ping",
      "path": ".kody/executables/inbox-ping/skills/inbox-ping/SKILL.md",
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
      "id": "skill:publish-release/publish-release",
      "type": "skill",
      "slug": "publish-release/publish-release",
      "name": "publish-release",
      "path": ".kody/executables/publish-release/skills/publish-release/SKILL.md",
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
      "id": "skill:redispatch/redispatch",
      "type": "skill",
      "slug": "redispatch/redispatch",
      "name": "redispatch",
      "path": ".kody/executables/redispatch/skills/redispatch/SKILL.md",
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
      "id": "skill:task-memorize/task-memorize",
      "type": "skill",
      "slug": "task-memorize/task-memorize",
      "name": "task-memorize",
      "path": ".kody/executables/task-memorize/skills/task-memorize/SKILL.md",
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
      "id": "duty:approval-gate->assigned_to->staff:cto",
      "from": "duty:approval-gate",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:approval-gate->runs->executable:approval-gate",
      "from": "duty:approval-gate",
      "to": "executable:approval-gate",
      "relation": "runs"
    },
    {
      "id": "duty:architecture-audit->assigned_to->staff:cto",
      "from": "duty:architecture-audit",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:architecture-audit->runs->executable:architecture-audit",
      "from": "duty:architecture-audit",
      "to": "executable:architecture-audit",
      "relation": "runs"
    },
    {
      "id": "duty:ceo-performance-review->assigned_to->staff:ceo",
      "from": "duty:ceo-performance-review",
      "to": "staff:ceo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:ceo-performance-review->runs->executable:ceo-performance-review",
      "from": "duty:ceo-performance-review",
      "to": "executable:ceo-performance-review",
      "relation": "runs"
    },
    {
      "id": "duty:ci-health-graph->assigned_to->staff:qa",
      "from": "duty:ci-health-graph",
      "to": "staff:qa",
      "relation": "assigned_to"
    },
    {
      "id": "duty:ci-health-graph->reads_from->context:ci-health-graph",
      "from": "duty:ci-health-graph",
      "to": "context:ci-health-graph",
      "relation": "reads_from"
    },
    {
      "id": "duty:ci-health-graph->runs->executable:ci-health-graph",
      "from": "duty:ci-health-graph",
      "to": "executable:ci-health-graph",
      "relation": "runs"
    },
    {
      "id": "duty:ci-health-graph->writes_to->report:ci-health-graph",
      "from": "duty:ci-health-graph",
      "to": "report:ci-health-graph",
      "relation": "writes_to"
    },
    {
      "id": "duty:cleanup-branches->assigned_to->staff:coo",
      "from": "duty:cleanup-branches",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:cleanup-branches->runs->executable:cleanup-branches",
      "from": "duty:cleanup-branches",
      "to": "executable:cleanup-branches",
      "relation": "runs"
    },
    {
      "id": "duty:clear-empty-goals->assigned_to->staff:coo",
      "from": "duty:clear-empty-goals",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:clear-empty-goals->runs->executable:clear-empty-goals",
      "from": "duty:clear-empty-goals",
      "to": "executable:clear-empty-goals",
      "relation": "runs"
    },
    {
      "id": "duty:company-graph->assigned_to->staff:coo",
      "from": "duty:company-graph",
      "to": "staff:coo",
      "relation": "assigned_to"
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
      "id": "duty:coverage-floor->assigned_to->staff:cto",
      "from": "duty:coverage-floor",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:coverage-floor->runs->executable:coverage-floor",
      "from": "duty:coverage-floor",
      "to": "executable:coverage-floor",
      "relation": "runs"
    },
    {
      "id": "duty:dead-code-sweep->assigned_to->staff:coo",
      "from": "duty:dead-code-sweep",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:dead-code-sweep->runs->executable:dead-code-sweep",
      "from": "duty:dead-code-sweep",
      "to": "executable:dead-code-sweep",
      "relation": "runs"
    },
    {
      "id": "duty:dependency-bump->assigned_to->staff:coo",
      "from": "duty:dependency-bump",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:dependency-bump->runs->executable:dependency-bump",
      "from": "duty:dependency-bump",
      "to": "executable:dependency-bump",
      "relation": "runs"
    },
    {
      "id": "duty:dependency-graph->assigned_to->staff:cto",
      "from": "duty:dependency-graph",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:dependency-graph->reads_from->context:dependency-graph",
      "from": "duty:dependency-graph",
      "to": "context:dependency-graph",
      "relation": "reads_from"
    },
    {
      "id": "duty:dependency-graph->runs->executable:dependency-graph",
      "from": "duty:dependency-graph",
      "to": "executable:dependency-graph",
      "relation": "runs"
    },
    {
      "id": "duty:dependency-graph->writes_to->report:dependency-graph",
      "from": "duty:dependency-graph",
      "to": "report:dependency-graph",
      "relation": "writes_to"
    },
    {
      "id": "duty:design-review->assigned_to->staff:ux-designer",
      "from": "duty:design-review",
      "to": "staff:ux-designer",
      "relation": "assigned_to"
    },
    {
      "id": "duty:design-review->runs->executable:design-review",
      "from": "duty:design-review",
      "to": "executable:design-review",
      "relation": "runs"
    },
    {
      "id": "duty:dev-ci-health->assigned_to->staff:cto",
      "from": "duty:dev-ci-health",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:dev-ci-health->runs->executable:dev-ci-health",
      "from": "duty:dev-ci-health",
      "to": "executable:dev-ci-health",
      "relation": "runs"
    },
    {
      "id": "duty:docs-code->assigned_to->staff:tech-writer",
      "from": "duty:docs-code",
      "to": "staff:tech-writer",
      "relation": "assigned_to"
    },
    {
      "id": "duty:docs-code->runs->executable:docs-code",
      "from": "duty:docs-code",
      "to": "executable:docs-code",
      "relation": "runs"
    },
    {
      "id": "duty:docs-graph->assigned_to->staff:tech-writer",
      "from": "duty:docs-graph",
      "to": "staff:tech-writer",
      "relation": "assigned_to"
    },
    {
      "id": "duty:docs-graph->reads_from->context:docs-graph",
      "from": "duty:docs-graph",
      "to": "context:docs-graph",
      "relation": "reads_from"
    },
    {
      "id": "duty:docs-graph->runs->executable:docs-graph",
      "from": "duty:docs-graph",
      "to": "executable:docs-graph",
      "relation": "runs"
    },
    {
      "id": "duty:docs-graph->writes_to->report:docs-graph",
      "from": "duty:docs-graph",
      "to": "report:docs-graph",
      "relation": "writes_to"
    },
    {
      "id": "duty:docs-readme->assigned_to->staff:tech-writer",
      "from": "duty:docs-readme",
      "to": "staff:tech-writer",
      "relation": "assigned_to"
    },
    {
      "id": "duty:docs-readme->runs->executable:docs-readme",
      "from": "duty:docs-readme",
      "to": "executable:docs-readme",
      "relation": "runs"
    },
    {
      "id": "duty:duty-call->assigned_to->staff:ceo",
      "from": "duty:duty-call",
      "to": "staff:ceo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:duty-call->runs->executable:duty-call",
      "from": "duty:duty-call",
      "to": "executable:duty-call",
      "relation": "runs"
    },
    {
      "id": "duty:duty-review->assigned_to->staff:coo",
      "from": "duty:duty-review",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:duty-review->runs->executable:duty-review",
      "from": "duty:duty-review",
      "to": "executable:duty-review",
      "relation": "runs"
    },
    {
      "id": "duty:flaky-test-quarantine->assigned_to->staff:cto",
      "from": "duty:flaky-test-quarantine",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:flaky-test-quarantine->runs->executable:flaky-test-quarantine",
      "from": "duty:flaky-test-quarantine",
      "to": "executable:flaky-test-quarantine",
      "relation": "runs"
    },
    {
      "id": "duty:health-check->assigned_to->staff:coo",
      "from": "duty:health-check",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:health-check->runs->executable:health-check",
      "from": "duty:health-check",
      "to": "executable:health-check",
      "relation": "runs"
    },
    {
      "id": "duty:inbox-ping->assigned_to->staff:coo",
      "from": "duty:inbox-ping",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:inbox-ping->runs->executable:inbox-ping",
      "from": "duty:inbox-ping",
      "to": "executable:inbox-ping",
      "relation": "runs"
    },
    {
      "id": "duty:memory-compaction->assigned_to->staff:coo",
      "from": "duty:memory-compaction",
      "to": "staff:coo",
      "relation": "assigned_to"
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
      "id": "duty:pr-graph->assigned_to->staff:coo",
      "from": "duty:pr-graph",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:pr-graph->reads_from->context:pr-graph",
      "from": "duty:pr-graph",
      "to": "context:pr-graph",
      "relation": "reads_from"
    },
    {
      "id": "duty:pr-graph->runs->executable:pr-graph",
      "from": "duty:pr-graph",
      "to": "executable:pr-graph",
      "relation": "runs"
    },
    {
      "id": "duty:pr-graph->writes_to->report:pr-graph",
      "from": "duty:pr-graph",
      "to": "report:pr-graph",
      "relation": "writes_to"
    },
    {
      "id": "duty:pr-health-triage->assigned_to->staff:cto",
      "from": "duty:pr-health-triage",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:pr-health-triage->runs->executable:pr-health-triage",
      "from": "duty:pr-health-triage",
      "to": "executable:pr-health-triage",
      "relation": "runs"
    },
    {
      "id": "duty:publish-release->assigned_to->staff:coo",
      "from": "duty:publish-release",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:publish-release->runs->executable:publish-release",
      "from": "duty:publish-release",
      "to": "executable:publish-release",
      "relation": "runs"
    },
    {
      "id": "duty:qa->assigned_to->staff:qa",
      "from": "duty:qa",
      "to": "staff:qa",
      "relation": "assigned_to"
    },
    {
      "id": "duty:qa->runs->executable:qa",
      "from": "duty:qa",
      "to": "executable:qa",
      "relation": "runs"
    },
    {
      "id": "duty:qa-sweep->assigned_to->staff:qa",
      "from": "duty:qa-sweep",
      "to": "staff:qa",
      "relation": "assigned_to"
    },
    {
      "id": "duty:qa-sweep->runs->executable:qa-sweep",
      "from": "duty:qa-sweep",
      "to": "executable:qa-sweep",
      "relation": "runs"
    },
    {
      "id": "duty:qa-verify->assigned_to->staff:qa",
      "from": "duty:qa-verify",
      "to": "staff:qa",
      "relation": "assigned_to"
    },
    {
      "id": "duty:qa-verify->runs->executable:qa-verify",
      "from": "duty:qa-verify",
      "to": "executable:qa-verify",
      "relation": "runs"
    },
    {
      "id": "duty:redispatch->assigned_to->staff:coo",
      "from": "duty:redispatch",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:redispatch->runs->executable:redispatch",
      "from": "duty:redispatch",
      "to": "executable:redispatch",
      "relation": "runs"
    },
    {
      "id": "duty:security-audit->assigned_to->staff:cto",
      "from": "duty:security-audit",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:security-audit->runs->executable:security-audit",
      "from": "duty:security-audit",
      "to": "executable:security-audit",
      "relation": "runs"
    },
    {
      "id": "duty:skills-research->assigned_to->staff:cto",
      "from": "duty:skills-research",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:skills-research->runs->executable:skills-research",
      "from": "duty:skills-research",
      "to": "executable:skills-research",
      "relation": "runs"
    },
    {
      "id": "duty:system-audit->assigned_to->staff:coo",
      "from": "duty:system-audit",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:system-audit->runs->executable:system-audit",
      "from": "duty:system-audit",
      "to": "executable:system-audit",
      "relation": "runs"
    },
    {
      "id": "duty:task-memorize->assigned_to->staff:coo",
      "from": "duty:task-memorize",
      "to": "staff:coo",
      "relation": "assigned_to"
    },
    {
      "id": "duty:task-memorize->runs->executable:task-memorize",
      "from": "duty:task-memorize",
      "to": "executable:task-memorize",
      "relation": "runs"
    },
    {
      "id": "duty:type-debt->assigned_to->staff:cto",
      "from": "duty:type-debt",
      "to": "staff:cto",
      "relation": "assigned_to"
    },
    {
      "id": "duty:type-debt->runs->executable:type-debt",
      "from": "duty:type-debt",
      "to": "executable:type-debt",
      "relation": "runs"
    },
    {
      "id": "duty:work-briefing->assigned_to->staff:coo",
      "from": "duty:work-briefing",
      "to": "staff:coo",
      "relation": "assigned_to"
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
      "id": "executable:cleanup-branches->uses_skill->skill:cleanup-branches/cleanup-branches",
      "from": "executable:cleanup-branches",
      "to": "skill:cleanup-branches/cleanup-branches",
      "relation": "uses_skill"
    },
    {
      "id": "executable:clear-empty-goals->uses_skill->skill:clear-empty-goals/clear-empty-goals",
      "from": "executable:clear-empty-goals",
      "to": "skill:clear-empty-goals/clear-empty-goals",
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
      "id": "executable:inbox-ping->uses_skill->skill:inbox-ping/inbox-ping",
      "from": "executable:inbox-ping",
      "to": "skill:inbox-ping/inbox-ping",
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
      "id": "executable:publish-release->uses_skill->skill:publish-release/publish-release",
      "from": "executable:publish-release",
      "to": "skill:publish-release/publish-release",
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
      "id": "executable:redispatch->uses_skill->skill:redispatch/redispatch",
      "from": "executable:redispatch",
      "to": "skill:redispatch/redispatch",
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
      "id": "executable:task-memorize->uses_skill->skill:task-memorize/task-memorize",
      "from": "executable:task-memorize",
      "to": "skill:task-memorize/task-memorize",
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
      "id": "executable:work-briefing->uses_skill->skill:work-briefing/work-briefing",
      "from": "executable:work-briefing",
      "to": "skill:work-briefing/work-briefing",
      "relation": "uses_skill"
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
    "runs",
    "sessions",
    "tasks"
  ]
}
```
