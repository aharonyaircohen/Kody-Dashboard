---
slug: ci-health-graph
dutySlug: ci-health-graph
generatedAt: "2026-06-11T16:07:55Z"
findings:
  - id: ci-health-graph.snapshot
    severity: low
    title: "CI health snapshot emitted"
    data: {"raw":"{\"nodeCounts\":{\"workflows\":3,\"runs\":100,\"branches\":18,\"prs\":15,\"checks\":41},\"graphHash\":\"e9cc124d12794ff699a933d3cf8eaa63592c7a090763ccd687cbf54b6e0ea3c9\"}}"}
  - id: ci-health-graph.flaky.ci
    severity: medium
    title: "CI has mixed recent results"
    data: {"raw":"{\"workflow\":\"CI\",\"conclusions\":[\"failure\",\"success\"]}}"}
  - id: ci-health-graph.flaky.e2e-tests
    severity: medium
    title: "E2E Tests has mixed recent results"
    data: {"raw":"{\"workflow\":\"E2E Tests\",\"conclusions\":[\"failure\",\"success\"]}}"}
  - id: ci-health-graph.flaky.kody
    severity: medium
    title: "kody has mixed recent results"
    data: {"raw":"{\"workflow\":\"kody\",\"conclusions\":[\"cancelled\",\"failure\",\"success\"]}}"}
  - id: ci-health-graph.pr-blocked.155
    severity: high
    title: "PR #155 has non-green checks"
    data: {"raw":"{\"number\":155,\"title\":\"#151: Publish to Vercel executable (multi-account, multi-project)\",\"url\":\"https://github.com/aharonyaircohen/Kody-Dashboard/pull/155\",\"checks\":[{\"name\":\"Quality Checks\",\"status\":\"COMPLETED\",\"conclusion\":\"FAILURE\"},{\"name\":\"Vitest (unit + integration)\",\"status\":\"COMPLETED\",\"conclusion\":\"FAILURE\"}]}}"}
---

# CI Health Graph

| Node type | Count |
|---|---:|
| workflows | 3 |
| runs | 100 |
| branches | 18 |
| prs | 15 |
| checks | 41 |

Graph hash: `e9cc124d12794ff699a933d3cf8eaa63592c7a090763ccd687cbf54b6e0ea3c9`

## Graph
```json
{
  "schemaVersion": 1,
  "nodes": [
    {
      "id": "branch:141-chat-preview-inspector-chips-leak-their-full-conte",
      "type": "branch",
      "name": "141-chat-preview-inspector-chips-leak-their-full-conte"
    },
    {
      "id": "branch:151-publish-to-vercel-executable-multi-account-multi-p",
      "type": "branch",
      "name": "151-publish-to-vercel-executable-multi-account-multi-p"
    },
    {
      "id": "branch:153-doc-coverage-gap-srcdashboardlibrunners",
      "type": "branch",
      "name": "153-doc-coverage-gap-srcdashboardlibrunners"
    },
    {
      "id": "branch:157-update-dashboard-for-new-engine-duty-contract",
      "type": "branch",
      "name": "157-update-dashboard-for-new-engine-duty-contract"
    },
    {
      "id": "branch:159-docs-coverage-srcdashboardlibrunners",
      "type": "branch",
      "name": "159-docs-coverage-srcdashboardlibrunners"
    },
    {
      "id": "branch:161-doc-coverage-gap-srcdashboardlibnotificationschann",
      "type": "branch",
      "name": "161-doc-coverage-gap-srcdashboardlibnotificationschann"
    },
    {
      "id": "branch:163-doc-coverage-gap-srcdashboardlibrunners",
      "type": "branch",
      "name": "163-doc-coverage-gap-srcdashboardlibrunners"
    },
    {
      "id": "branch:24-docs-drift-docsnotificationsmd-20",
      "type": "branch",
      "name": "24-docs-drift-docsnotificationsmd-20"
    },
    {
      "id": "branch:27-ui-page-title-duplicated-in-browser-tab",
      "type": "branch",
      "name": "27-ui-page-title-duplicated-in-browser-tab"
    },
    {
      "id": "branch:31-27-ui-page-title-duplicated-in-browser-tab",
      "type": "branch",
      "name": "31-27-ui-page-title-duplicated-in-browser-tab"
    },
    {
      "id": "branch:39-25-keep-screen-always-on-during-voice-mode",
      "type": "branch",
      "name": "39-25-keep-screen-always-on-during-voice-mode"
    },
    {
      "id": "branch:40-26-files-fully-featured-file-browser-and-editor-at",
      "type": "branch",
      "name": "40-26-files-fully-featured-file-browser-and-editor-at"
    },
    {
      "id": "branch:62-31-ui-page-title-duplicated-in-browser-tab",
      "type": "branch",
      "name": "62-31-ui-page-title-duplicated-in-browser-tab"
    },
    {
      "id": "branch:66-unify-chat-thread-across-dashboard-pages",
      "type": "branch",
      "name": "66-unify-chat-thread-across-dashboard-pages"
    },
    {
      "id": "branch:codex/fix-ci",
      "type": "branch",
      "name": "codex/fix-ci"
    },
    {
      "id": "branch:codex/fix-preview-query-path-30",
      "type": "branch",
      "name": "codex/fix-preview-query-path-30"
    },
    {
      "id": "branch:kody-state",
      "type": "branch",
      "name": "kody-state"
    },
    {
      "id": "branch:main",
      "type": "branch",
      "name": "main"
    },
    {
      "id": "check:109/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:109/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:109/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:144/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:144/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:144/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:154/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:154/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:154/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:155/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:155/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "FAILURE"
    },
    {
      "id": "check:155/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "FAILURE"
    },
    {
      "id": "check:160/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:160/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:160/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:162/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:162/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:162/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:164/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:164/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:164/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:36/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:36/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:36/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:41/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:41/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:41/vercel-kody",
      "type": "check",
      "name": "Vercel – kody",
      "status": "SUCCESS",
      "conclusion": ""
    },
    {
      "id": "check:41/vercel-kody-dashboard",
      "type": "check",
      "name": "Vercel – kody-dashboard",
      "status": "SUCCESS",
      "conclusion": ""
    },
    {
      "id": "check:41/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:42/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:42/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:42/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:62/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:62/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:62/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:63/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:63/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:63/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:71/production-smoke",
      "type": "check",
      "name": "Production Smoke",
      "status": "COMPLETED",
      "conclusion": "SKIPPED"
    },
    {
      "id": "check:71/quality-checks",
      "type": "check",
      "name": "Quality Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "check:71/vitest-unit-integration",
      "type": "check",
      "name": "Vitest (unit + integration)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS"
    },
    {
      "id": "pr:109",
      "type": "pr",
      "number": 109,
      "title": "#24: docs-drift: docs/notifications.md (#20)",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/109",
      "updatedAt": "2026-06-07T20:30:39Z",
      "isDraft": false
    },
    {
      "id": "pr:144",
      "type": "pr",
      "number": 144,
      "title": "#141: [Chat] Preview Inspector chips leak their full context into the u…",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/144",
      "updatedAt": "2026-06-08T07:32:04Z",
      "isDraft": false
    },
    {
      "id": "pr:154",
      "type": "pr",
      "number": 154,
      "title": "#153: Doc-coverage gap: src/dashboard/lib/runners/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/154",
      "updatedAt": "2026-06-08T10:21:21Z",
      "isDraft": false
    },
    {
      "id": "pr:155",
      "type": "pr",
      "number": 155,
      "title": "#151: Publish to Vercel executable (multi-account, multi-project)",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/155",
      "updatedAt": "2026-06-08T11:36:28Z",
      "isDraft": false
    },
    {
      "id": "pr:158",
      "type": "pr",
      "number": 158,
      "title": "#157: Update dashboard for new engine duty contract",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/158",
      "updatedAt": "2026-06-08T19:52:49Z",
      "isDraft": false
    },
    {
      "id": "pr:160",
      "type": "pr",
      "number": 160,
      "title": "#159: docs-coverage: src/dashboard/lib/runners/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/160",
      "updatedAt": "2026-06-09T12:04:14Z",
      "isDraft": false
    },
    {
      "id": "pr:162",
      "type": "pr",
      "number": 162,
      "title": "#161: Doc coverage gap: src/dashboard/lib/notifications/channels/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/162",
      "updatedAt": "2026-06-09T17:13:20Z",
      "isDraft": false
    },
    {
      "id": "pr:164",
      "type": "pr",
      "number": 164,
      "title": "#163: Doc coverage gap: src/dashboard/lib/runners/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/164",
      "updatedAt": "2026-06-09T21:32:43Z",
      "isDraft": false
    },
    {
      "id": "pr:32",
      "type": "pr",
      "number": 32,
      "title": "Kody state",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/32",
      "updatedAt": "2026-06-11T15:37:31Z",
      "isDraft": false
    },
    {
      "id": "pr:36",
      "type": "pr",
      "number": 36,
      "title": "#31: [UI] Page title duplicated in browser tab",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/36",
      "updatedAt": "2026-06-08T17:48:07Z",
      "isDraft": false
    },
    {
      "id": "pr:41",
      "type": "pr",
      "number": 41,
      "title": "#40: [Files] Fully-featured file browser and editor at /files",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/41",
      "updatedAt": "2026-06-11T09:44:12Z",
      "isDraft": false
    },
    {
      "id": "pr:42",
      "type": "pr",
      "number": 42,
      "title": "#39: Keep screen always on during voice mode",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/42",
      "updatedAt": "2026-06-11T13:24:07Z",
      "isDraft": false
    },
    {
      "id": "pr:62",
      "type": "pr",
      "number": 62,
      "title": "#31: [UI] Page title duplicated in browser tab",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/62",
      "updatedAt": "2026-06-09T09:06:45Z",
      "isDraft": false
    },
    {
      "id": "pr:63",
      "type": "pr",
      "number": 63,
      "title": "#62: [UI] Page title duplicated in browser tab",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/63",
      "updatedAt": "2026-06-07T19:19:27Z",
      "isDraft": false
    },
    {
      "id": "pr:71",
      "type": "pr",
      "number": 71,
      "title": "#68: Unify chat thread across dashboard pages",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/pull/71",
      "updatedAt": "2026-06-07T09:55:29Z",
      "isDraft": false
    },
    {
      "id": "run:27262633728",
      "type": "run",
      "databaseId": 27262633728,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "Add docs management and preview updates",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27262633728",
      "createdAt": "2026-06-10T08:11:40Z"
    },
    {
      "id": "run:27264385250",
      "type": "run",
      "databaseId": 27264385250,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27264385250",
      "createdAt": "2026-06-10T08:44:23Z"
    },
    {
      "id": "run:27264808174",
      "type": "run",
      "databaseId": 27264808174,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(ceo-performance-review): refresh report",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27264808174",
      "createdAt": "2026-06-10T08:51:57Z"
    },
    {
      "id": "run:27265579840",
      "type": "run",
      "databaseId": 27265579840,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27265579840",
      "createdAt": "2026-06-10T09:05:39Z"
    },
    {
      "id": "run:27265694482",
      "type": "run",
      "databaseId": 27265694482,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "#40: [Files] Fully-featured file browser and editor at /files",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27265694482",
      "createdAt": "2026-06-10T09:07:39Z"
    },
    {
      "id": "run:27265877710",
      "type": "run",
      "databaseId": 27265877710,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "#40: [Files] Fully-featured file browser and editor at /files",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27265877710",
      "createdAt": "2026-06-10T09:10:54Z"
    },
    {
      "id": "run:27267109213",
      "type": "run",
      "databaseId": 27267109213,
      "workflow": "E2E Tests",
      "status": "completed",
      "conclusion": "failure",
      "title": "E2E Tests",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27267109213",
      "createdAt": "2026-06-10T09:33:35Z"
    },
    {
      "id": "run:27274779825",
      "type": "run",
      "databaseId": 27274779825,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27274779825",
      "createdAt": "2026-06-10T12:01:56Z"
    },
    {
      "id": "run:27275463204",
      "type": "run",
      "databaseId": 27275463204,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(ceo-performance-review): refresh report",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27275463204",
      "createdAt": "2026-06-10T12:14:28Z"
    },
    {
      "id": "run:27275928433",
      "type": "run",
      "databaseId": 27275928433,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27275928433",
      "createdAt": "2026-06-10T12:23:01Z"
    },
    {
      "id": "run:27276032194",
      "type": "run",
      "databaseId": 27276032194,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "#39: Keep screen always on during voice mode",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27276032194",
      "createdAt": "2026-06-10T12:24:55Z"
    },
    {
      "id": "run:27276207677",
      "type": "run",
      "databaseId": 27276207677,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "#39: Keep screen always on during voice mode",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27276207677",
      "createdAt": "2026-06-10T12:28:07Z"
    },
    {
      "id": "run:27285228753",
      "type": "run",
      "databaseId": 27285228753,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "fix: preserve preview query when joining paths",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27285228753",
      "createdAt": "2026-06-10T14:57:26Z"
    },
    {
      "id": "run:27285228754",
      "type": "run",
      "databaseId": 27285228754,
      "workflow": "E2E Tests",
      "status": "completed",
      "conclusion": "success",
      "title": "fix: preserve preview query when joining paths",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27285228754",
      "createdAt": "2026-06-10T14:57:26Z"
    },
    {
      "id": "run:27285554796",
      "type": "run",
      "databaseId": 27285554796,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "fix: preserve preview query when joining paths (#166)",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27285554796",
      "createdAt": "2026-06-10T15:02:28Z"
    },
    {
      "id": "run:27285555815",
      "type": "run",
      "databaseId": 27285555815,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "fix: preserve preview query when joining paths",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27285555815",
      "createdAt": "2026-06-10T15:02:29Z"
    },
    {
      "id": "run:27286508647",
      "type": "run",
      "databaseId": 27286508647,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "docs: require next-step question",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27286508647",
      "createdAt": "2026-06-10T15:18:56Z"
    },
    {
      "id": "run:27286615495",
      "type": "run",
      "databaseId": 27286615495,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "Revert \"docs: require next-step question\"",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27286615495",
      "createdAt": "2026-06-10T15:20:51Z"
    },
    {
      "id": "run:27286757339",
      "type": "run",
      "databaseId": 27286757339,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "Remove redundant Fly runner services",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27286757339",
      "createdAt": "2026-06-10T15:23:25Z"
    },
    {
      "id": "run:27288099523",
      "type": "run",
      "databaseId": 27288099523,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "fix: preserve preview view query params",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27288099523",
      "createdAt": "2026-06-10T15:47:37Z"
    },
    {
      "id": "run:27288934615",
      "type": "run",
      "databaseId": 27288934615,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "Restore Fly warm pool without shared LiteLLM",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27288934615",
      "createdAt": "2026-06-10T16:02:45Z"
    },
    {
      "id": "run:27289144667",
      "type": "run",
      "databaseId": 27289144667,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27289144667",
      "createdAt": "2026-06-10T16:06:35Z"
    },
    {
      "id": "run:27289697936",
      "type": "run",
      "databaseId": 27289697936,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "chore(ceo-performance-review): refresh report",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27289697936",
      "createdAt": "2026-06-10T16:16:58Z"
    },
    {
      "id": "run:27298073434",
      "type": "run",
      "databaseId": 27298073434,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27298073434",
      "createdAt": "2026-06-10T18:40:47Z"
    },
    {
      "id": "run:27298216767",
      "type": "run",
      "databaseId": 27298216767,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore: upgrade to Next 16",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27298216767",
      "createdAt": "2026-06-10T18:43:18Z"
    },
    {
      "id": "run:27298576831",
      "type": "run",
      "databaseId": 27298576831,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(ceo-performance-review): refresh report",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27298576831",
      "createdAt": "2026-06-10T18:49:34Z"
    },
    {
      "id": "run:27299079879",
      "type": "run",
      "databaseId": 27299079879,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27299079879",
      "createdAt": "2026-06-10T18:58:15Z"
    },
    {
      "id": "run:27299185270",
      "type": "run",
      "databaseId": 27299185270,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "#39: Keep screen always on during voice mode",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27299185270",
      "createdAt": "2026-06-10T19:00:06Z"
    },
    {
      "id": "run:27299581386",
      "type": "run",
      "databaseId": 27299581386,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "#39: Keep screen always on during voice mode",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27299581386",
      "createdAt": "2026-06-10T19:06:57Z"
    },
    {
      "id": "run:27306737826",
      "type": "run",
      "databaseId": 27306737826,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27306737826",
      "createdAt": "2026-06-10T21:13:21Z"
    },
    {
      "id": "run:27307156113",
      "type": "run",
      "databaseId": 27307156113,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(ceo-performance-review): refresh report",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27307156113",
      "createdAt": "2026-06-10T21:21:22Z"
    },
    {
      "id": "run:27307507086",
      "type": "run",
      "databaseId": 27307507086,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27307507086",
      "createdAt": "2026-06-10T21:27:55Z"
    },
    {
      "id": "run:27307593104",
      "type": "run",
      "databaseId": 27307593104,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "#39: Keep screen always on during voice mode",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27307593104",
      "createdAt": "2026-06-10T21:29:34Z"
    },
    {
      "id": "run:27307837951",
      "type": "run",
      "databaseId": 27307837951,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "#39: Keep screen always on during voice mode",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27307837951",
      "createdAt": "2026-06-10T21:34:13Z"
    },
    {
      "id": "run:27311732665",
      "type": "run",
      "databaseId": 27311732665,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27311732665",
      "createdAt": "2026-06-10T22:57:18Z"
    },
    {
      "id": "run:27312202105",
      "type": "run",
      "databaseId": 27312202105,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(ceo-performance-review): refresh report",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27312202105",
      "createdAt": "2026-06-10T23:07:55Z"
    },
    {
      "id": "run:27312477606",
      "type": "run",
      "databaseId": 27312477606,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27312477606",
      "createdAt": "2026-06-10T23:14:27Z"
    },
    {
      "id": "run:27312537939",
      "type": "run",
      "databaseId": 27312537939,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27312537939",
      "createdAt": "2026-06-10T23:15:53Z"
    },
    {
      "id": "run:27312540800",
      "type": "run",
      "databaseId": 27312540800,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "#40: [Files] Fully-featured file browser and editor at /files",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27312540800",
      "createdAt": "2026-06-10T23:15:57Z"
    },
    {
      "id": "run:27312607410",
      "type": "run",
      "databaseId": 27312607410,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "#40: [Files] Fully-featured file browser and editor at /files",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27312607410",
      "createdAt": "2026-06-10T23:17:38Z"
    },
    {
      "id": "run:27314922348",
      "type": "run",
      "databaseId": 27314922348,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27314922348",
      "createdAt": "2026-06-11T00:15:09Z"
    },
    {
      "id": "run:27315286366",
      "type": "run",
      "databaseId": 27315286366,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(ceo-performance-review): refresh report",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27315286366",
      "createdAt": "2026-06-11T00:24:40Z"
    },
    {
      "id": "run:27315485887",
      "type": "run",
      "databaseId": 27315485887,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27315485887",
      "createdAt": "2026-06-11T00:29:54Z"
    },
    {
      "id": "run:27315559400",
      "type": "run",
      "databaseId": 27315559400,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "#40: [Files] Fully-featured file browser and editor at /files",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27315559400",
      "createdAt": "2026-06-11T00:31:39Z"
    },
    {
      "id": "run:27315788319",
      "type": "run",
      "databaseId": 27315788319,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "#40: [Files] Fully-featured file browser and editor at /files",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27315788319",
      "createdAt": "2026-06-11T00:37:30Z"
    },
    {
      "id": "run:27325167929",
      "type": "run",
      "databaseId": 27325167929,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27325167929",
      "createdAt": "2026-06-11T05:06:52Z"
    },
    {
      "id": "run:27325524638",
      "type": "run",
      "databaseId": 27325524638,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(ceo-performance-review): refresh report",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27325524638",
      "createdAt": "2026-06-11T05:16:46Z"
    },
    {
      "id": "run:27325711636",
      "type": "run",
      "databaseId": 27325711636,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "failure",
      "title": "Doc coverage gap: src/dashboard/lib/hooks/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27325711636",
      "createdAt": "2026-06-11T05:22:06Z"
    },
    {
      "id": "run:27325753610",
      "type": "run",
      "databaseId": 27325753610,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "Doc coverage gap: src/dashboard/lib/hooks/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27325753610",
      "createdAt": "2026-06-11T05:23:16Z"
    },
    {
      "id": "run:27325851600",
      "type": "run",
      "databaseId": 27325851600,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27325851600",
      "createdAt": "2026-06-11T05:25:59Z"
    },
    {
      "id": "run:27325908991",
      "type": "run",
      "databaseId": 27325908991,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "#40: [Files] Fully-featured file browser and editor at /files",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27325908991",
      "createdAt": "2026-06-11T05:27:37Z"
    },
    {
      "id": "run:27326103506",
      "type": "run",
      "databaseId": 27326103506,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "#40: [Files] Fully-featured file browser and editor at /files",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27326103506",
      "createdAt": "2026-06-11T05:32:47Z"
    },
    {
      "id": "run:27326181860",
      "type": "run",
      "databaseId": 27326181860,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "Doc coverage gap: src/dashboard/lib/hooks/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27326181860",
      "createdAt": "2026-06-11T05:34:50Z"
    },
    {
      "id": "run:27326183682",
      "type": "run",
      "databaseId": 27326183682,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "Doc coverage gap: src/dashboard/lib/hooks/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27326183682",
      "createdAt": "2026-06-11T05:34:53Z"
    },
    {
      "id": "run:27326186031",
      "type": "run",
      "databaseId": 27326186031,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "Doc coverage gap: src/dashboard/lib/hooks/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27326186031",
      "createdAt": "2026-06-11T05:34:57Z"
    },
    {
      "id": "run:27336874559",
      "type": "run",
      "databaseId": 27336874559,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27336874559",
      "createdAt": "2026-06-11T09:19:37Z"
    },
    {
      "id": "run:27337221275",
      "type": "run",
      "databaseId": 27337221275,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(ceo-performance-review): refresh report",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27337221275",
      "createdAt": "2026-06-11T09:26:06Z"
    },
    {
      "id": "run:27337660637",
      "type": "run",
      "databaseId": 27337660637,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "failure",
      "title": "docs-code: src/dashboard/lib/runners/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27337660637",
      "createdAt": "2026-06-11T09:34:12Z"
    },
    {
      "id": "run:27337733444",
      "type": "run",
      "databaseId": 27337733444,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "docs-code: src/dashboard/lib/runners/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27337733444",
      "createdAt": "2026-06-11T09:35:31Z"
    },
    {
      "id": "run:27337740662",
      "type": "run",
      "databaseId": 27337740662,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "docs-code: tick 2026-06-11 — flagged runners/, corrected verb",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27337740662",
      "createdAt": "2026-06-11T09:35:39Z"
    },
    {
      "id": "run:27337947544",
      "type": "run",
      "databaseId": 27337947544,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27337947544",
      "createdAt": "2026-06-11T09:39:30Z"
    },
    {
      "id": "run:27338033697",
      "type": "run",
      "databaseId": 27338033697,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "#40: [Files] Fully-featured file browser and editor at /files",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27338033697",
      "createdAt": "2026-06-11T09:41:07Z"
    },
    {
      "id": "run:27338207181",
      "type": "run",
      "databaseId": 27338207181,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "#40: [Files] Fully-featured file browser and editor at /files",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27338207181",
      "createdAt": "2026-06-11T09:44:15Z"
    },
    {
      "id": "run:27338708832",
      "type": "run",
      "databaseId": 27338708832,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "docs-code: src/dashboard/lib/runners/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27338708832",
      "createdAt": "2026-06-11T09:53:33Z"
    },
    {
      "id": "run:27338713196",
      "type": "run",
      "databaseId": 27338713196,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "docs-code: src/dashboard/lib/runners/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27338713196",
      "createdAt": "2026-06-11T09:53:37Z"
    },
    {
      "id": "run:27338714402",
      "type": "run",
      "databaseId": 27338714402,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "docs-code: src/dashboard/lib/runners/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27338714402",
      "createdAt": "2026-06-11T09:53:38Z"
    },
    {
      "id": "run:27338865100",
      "type": "run",
      "databaseId": 27338865100,
      "workflow": "E2E Tests",
      "status": "completed",
      "conclusion": "failure",
      "title": "E2E Tests",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27338865100",
      "createdAt": "2026-06-11T09:56:25Z"
    },
    {
      "id": "run:27343056390",
      "type": "run",
      "databaseId": 27343056390,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "feat: update dashboard attachments and terminal flows",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27343056390",
      "createdAt": "2026-06-11T11:17:57Z"
    },
    {
      "id": "run:27347167535",
      "type": "run",
      "databaseId": 27347167535,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "feat(duties): add repo-graph (via chat by @aharonyaircohen)",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27347167535",
      "createdAt": "2026-06-11T12:35:55Z"
    },
    {
      "id": "run:27347269812",
      "type": "run",
      "databaseId": 27347269812,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "chore(duties): remove repo-graph",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27347269812",
      "createdAt": "2026-06-11T12:37:49Z"
    },
    {
      "id": "run:27347312185",
      "type": "run",
      "databaseId": 27347312185,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "chore(memory): add create-kody-duty-frontmatter-unreliable (via chat …",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27347312185",
      "createdAt": "2026-06-11T12:38:35Z"
    },
    {
      "id": "run:27347312501",
      "type": "run",
      "databaseId": 27347312501,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "chore(memory): refresh INDEX after add create-kody-duty-frontmatter-u…",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27347312501",
      "createdAt": "2026-06-11T12:38:35Z"
    },
    {
      "id": "run:27347417656",
      "type": "run",
      "databaseId": 27347417656,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "feat(duties): add repo-graph (via chat by @aharonyaircohen)",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27347417656",
      "createdAt": "2026-06-11T12:40:29Z"
    },
    {
      "id": "run:27348479183",
      "type": "run",
      "databaseId": 27348479183,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27348479183",
      "createdAt": "2026-06-11T12:58:57Z"
    },
    {
      "id": "run:27348969787",
      "type": "run",
      "databaseId": 27348969787,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "chore(ceo-performance-review): refresh report",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27348969787",
      "createdAt": "2026-06-11T13:07:08Z"
    },
    {
      "id": "run:27349214050",
      "type": "run",
      "databaseId": 27349214050,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "failure",
      "title": "Doc coverage gap: src/dashboard/lib/terminal/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27349214050",
      "createdAt": "2026-06-11T13:11:13Z"
    },
    {
      "id": "run:27349297380",
      "type": "run",
      "databaseId": 27349297380,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "Doc coverage gap: src/dashboard/lib/terminal/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27349297380",
      "createdAt": "2026-06-11T13:12:37Z"
    },
    {
      "id": "run:27349398479",
      "type": "run",
      "databaseId": 27349398479,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "kody",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27349398479",
      "createdAt": "2026-06-11T13:14:18Z"
    },
    {
      "id": "run:27349509780",
      "type": "run",
      "databaseId": 27349509780,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "#39: Keep screen always on during voice mode",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27349509780",
      "createdAt": "2026-06-11T13:16:10Z"
    },
    {
      "id": "run:27349984628",
      "type": "run",
      "databaseId": 27349984628,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "#39: Keep screen always on during voice mode",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27349984628",
      "createdAt": "2026-06-11T13:24:10Z"
    },
    {
      "id": "run:27350343002",
      "type": "run",
      "databaseId": 27350343002,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "Doc coverage gap: src/dashboard/lib/terminal/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27350343002",
      "createdAt": "2026-06-11T13:30:13Z"
    },
    {
      "id": "run:27350347439",
      "type": "run",
      "databaseId": 27350347439,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "cancelled",
      "title": "Doc coverage gap: src/dashboard/lib/terminal/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27350347439",
      "createdAt": "2026-06-11T13:30:17Z"
    },
    {
      "id": "run:27350353627",
      "type": "run",
      "databaseId": 27350353627,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "Doc coverage gap: src/dashboard/lib/terminal/",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27350353627",
      "createdAt": "2026-06-11T13:30:22Z"
    },
    {
      "id": "run:27351841351",
      "type": "run",
      "databaseId": 27351841351,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "failure",
      "title": "chore(duties): update repo-graph",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27351841351",
      "createdAt": "2026-06-11T13:54:00Z"
    },
    {
      "id": "run:27351872653",
      "type": "run",
      "databaseId": 27351872653,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "Kody control",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27351872653",
      "createdAt": "2026-06-11T13:54:29Z"
    },
    {
      "id": "run:27351892812",
      "type": "run",
      "databaseId": 27351892812,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "Kody control",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27351892812",
      "createdAt": "2026-06-11T13:54:48Z"
    },
    {
      "id": "run:27352571149",
      "type": "run",
      "databaseId": 27352571149,
      "workflow": "E2E Tests",
      "status": "completed",
      "conclusion": "success",
      "title": "fix: repair chat composer ci test",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27352571149",
      "createdAt": "2026-06-11T14:05:07Z"
    },
    {
      "id": "run:27352571432",
      "type": "run",
      "databaseId": 27352571432,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "fix: repair chat composer ci test",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27352571432",
      "createdAt": "2026-06-11T14:05:08Z"
    },
    {
      "id": "run:27352608192",
      "type": "run",
      "databaseId": 27352608192,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "fix: repair chat composer ci test (#171)",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27352608192",
      "createdAt": "2026-06-11T14:05:41Z"
    },
    {
      "id": "run:27352609777",
      "type": "run",
      "databaseId": 27352609777,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "fix: repair chat composer ci test",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27352609777",
      "createdAt": "2026-06-11T14:05:42Z"
    },
    {
      "id": "run:27353061212",
      "type": "run",
      "databaseId": 27353061212,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "Kody control",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27353061212",
      "createdAt": "2026-06-11T14:12:44Z"
    },
    {
      "id": "run:27353089006",
      "type": "run",
      "databaseId": 27353089006,
      "workflow": "kody",
      "status": "completed",
      "conclusion": "success",
      "title": "Kody control",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27353089006",
      "createdAt": "2026-06-11T14:13:10Z"
    },
    {
      "id": "run:27353436434",
      "type": "run",
      "databaseId": 27353436434,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(repo-graph): split duty and executable",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27353436434",
      "createdAt": "2026-06-11T14:18:27Z"
    },
    {
      "id": "run:27353979628",
      "type": "run",
      "databaseId": 27353979628,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "fix(executables): read custom executable directory",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27353979628",
      "createdAt": "2026-06-11T14:26:38Z"
    },
    {
      "id": "run:27354903750",
      "type": "run",
      "databaseId": 27354903750,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(executables): make repo graph script-backed",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27354903750",
      "createdAt": "2026-06-11T14:40:53Z"
    },
    {
      "id": "run:27355738437",
      "type": "run",
      "databaseId": 27355738437,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(repo-graph): make executable no-agent",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27355738437",
      "createdAt": "2026-06-11T14:53:27Z"
    },
    {
      "id": "run:27356806693",
      "type": "run",
      "databaseId": 27356806693,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(company-graph): rename repo graph executable",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27356806693",
      "createdAt": "2026-06-11T15:09:16Z"
    },
    {
      "id": "run:27357106363",
      "type": "run",
      "databaseId": 27357106363,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(company-graph): remove output marker",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27357106363",
      "createdAt": "2026-06-11T15:13:47Z"
    },
    {
      "id": "run:27358525881",
      "type": "run",
      "databaseId": 27358525881,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore(reports): refresh company-graph",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27358525881",
      "createdAt": "2026-06-11T15:35:26Z"
    },
    {
      "id": "run:27359836005",
      "type": "run",
      "databaseId": 27359836005,
      "workflow": "CI",
      "status": "completed",
      "conclusion": "success",
      "title": "chore: sync kody duties and executables",
      "url": "https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/27359836005",
      "createdAt": "2026-06-11T15:56:25Z"
    },
    {
      "id": "workflow:ci",
      "type": "workflow",
      "name": "CI"
    },
    {
      "id": "workflow:e2e-tests",
      "type": "workflow",
      "name": "E2E Tests"
    },
    {
      "id": "workflow:kody",
      "type": "workflow",
      "name": "kody"
    }
  ],
  "edges": [
    {
      "id": "pr:109->has_check->check:109/production-smoke",
      "from": "pr:109",
      "to": "check:109/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:109->has_check->check:109/quality-checks",
      "from": "pr:109",
      "to": "check:109/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:109->has_check->check:109/vitest-unit-integration",
      "from": "pr:109",
      "to": "check:109/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:109->uses_branch->branch:24-docs-drift-docsnotificationsmd-20",
      "from": "pr:109",
      "to": "branch:24-docs-drift-docsnotificationsmd-20",
      "relation": "uses_branch"
    },
    {
      "id": "pr:144->has_check->check:144/production-smoke",
      "from": "pr:144",
      "to": "check:144/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:144->has_check->check:144/quality-checks",
      "from": "pr:144",
      "to": "check:144/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:144->has_check->check:144/vitest-unit-integration",
      "from": "pr:144",
      "to": "check:144/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:144->uses_branch->branch:141-chat-preview-inspector-chips-leak-their-full-conte",
      "from": "pr:144",
      "to": "branch:141-chat-preview-inspector-chips-leak-their-full-conte",
      "relation": "uses_branch"
    },
    {
      "id": "pr:154->has_check->check:154/production-smoke",
      "from": "pr:154",
      "to": "check:154/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:154->has_check->check:154/quality-checks",
      "from": "pr:154",
      "to": "check:154/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:154->has_check->check:154/vitest-unit-integration",
      "from": "pr:154",
      "to": "check:154/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:154->uses_branch->branch:153-doc-coverage-gap-srcdashboardlibrunners",
      "from": "pr:154",
      "to": "branch:153-doc-coverage-gap-srcdashboardlibrunners",
      "relation": "uses_branch"
    },
    {
      "id": "pr:155->has_check->check:155/production-smoke",
      "from": "pr:155",
      "to": "check:155/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:155->has_check->check:155/quality-checks",
      "from": "pr:155",
      "to": "check:155/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:155->has_check->check:155/vitest-unit-integration",
      "from": "pr:155",
      "to": "check:155/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:155->uses_branch->branch:151-publish-to-vercel-executable-multi-account-multi-p",
      "from": "pr:155",
      "to": "branch:151-publish-to-vercel-executable-multi-account-multi-p",
      "relation": "uses_branch"
    },
    {
      "id": "pr:158->uses_branch->branch:157-update-dashboard-for-new-engine-duty-contract",
      "from": "pr:158",
      "to": "branch:157-update-dashboard-for-new-engine-duty-contract",
      "relation": "uses_branch"
    },
    {
      "id": "pr:160->has_check->check:160/production-smoke",
      "from": "pr:160",
      "to": "check:160/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:160->has_check->check:160/quality-checks",
      "from": "pr:160",
      "to": "check:160/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:160->has_check->check:160/vitest-unit-integration",
      "from": "pr:160",
      "to": "check:160/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:160->uses_branch->branch:159-docs-coverage-srcdashboardlibrunners",
      "from": "pr:160",
      "to": "branch:159-docs-coverage-srcdashboardlibrunners",
      "relation": "uses_branch"
    },
    {
      "id": "pr:162->has_check->check:162/production-smoke",
      "from": "pr:162",
      "to": "check:162/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:162->has_check->check:162/quality-checks",
      "from": "pr:162",
      "to": "check:162/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:162->has_check->check:162/vitest-unit-integration",
      "from": "pr:162",
      "to": "check:162/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:162->uses_branch->branch:161-doc-coverage-gap-srcdashboardlibnotificationschann",
      "from": "pr:162",
      "to": "branch:161-doc-coverage-gap-srcdashboardlibnotificationschann",
      "relation": "uses_branch"
    },
    {
      "id": "pr:164->has_check->check:164/production-smoke",
      "from": "pr:164",
      "to": "check:164/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:164->has_check->check:164/quality-checks",
      "from": "pr:164",
      "to": "check:164/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:164->has_check->check:164/vitest-unit-integration",
      "from": "pr:164",
      "to": "check:164/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:164->uses_branch->branch:163-doc-coverage-gap-srcdashboardlibrunners",
      "from": "pr:164",
      "to": "branch:163-doc-coverage-gap-srcdashboardlibrunners",
      "relation": "uses_branch"
    },
    {
      "id": "pr:32->uses_branch->branch:kody-state",
      "from": "pr:32",
      "to": "branch:kody-state",
      "relation": "uses_branch"
    },
    {
      "id": "pr:36->has_check->check:36/production-smoke",
      "from": "pr:36",
      "to": "check:36/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:36->has_check->check:36/quality-checks",
      "from": "pr:36",
      "to": "check:36/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:36->has_check->check:36/vitest-unit-integration",
      "from": "pr:36",
      "to": "check:36/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:36->uses_branch->branch:27-ui-page-title-duplicated-in-browser-tab",
      "from": "pr:36",
      "to": "branch:27-ui-page-title-duplicated-in-browser-tab",
      "relation": "uses_branch"
    },
    {
      "id": "pr:41->has_check->check:41/production-smoke",
      "from": "pr:41",
      "to": "check:41/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:41->has_check->check:41/quality-checks",
      "from": "pr:41",
      "to": "check:41/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:41->has_check->check:41/vercel-kody",
      "from": "pr:41",
      "to": "check:41/vercel-kody",
      "relation": "has_check"
    },
    {
      "id": "pr:41->has_check->check:41/vercel-kody-dashboard",
      "from": "pr:41",
      "to": "check:41/vercel-kody-dashboard",
      "relation": "has_check"
    },
    {
      "id": "pr:41->has_check->check:41/vitest-unit-integration",
      "from": "pr:41",
      "to": "check:41/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:41->uses_branch->branch:40-26-files-fully-featured-file-browser-and-editor-at",
      "from": "pr:41",
      "to": "branch:40-26-files-fully-featured-file-browser-and-editor-at",
      "relation": "uses_branch"
    },
    {
      "id": "pr:42->has_check->check:42/production-smoke",
      "from": "pr:42",
      "to": "check:42/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:42->has_check->check:42/quality-checks",
      "from": "pr:42",
      "to": "check:42/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:42->has_check->check:42/vitest-unit-integration",
      "from": "pr:42",
      "to": "check:42/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:42->uses_branch->branch:39-25-keep-screen-always-on-during-voice-mode",
      "from": "pr:42",
      "to": "branch:39-25-keep-screen-always-on-during-voice-mode",
      "relation": "uses_branch"
    },
    {
      "id": "pr:62->has_check->check:62/production-smoke",
      "from": "pr:62",
      "to": "check:62/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:62->has_check->check:62/quality-checks",
      "from": "pr:62",
      "to": "check:62/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:62->has_check->check:62/vitest-unit-integration",
      "from": "pr:62",
      "to": "check:62/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:62->uses_branch->branch:31-27-ui-page-title-duplicated-in-browser-tab",
      "from": "pr:62",
      "to": "branch:31-27-ui-page-title-duplicated-in-browser-tab",
      "relation": "uses_branch"
    },
    {
      "id": "pr:63->has_check->check:63/production-smoke",
      "from": "pr:63",
      "to": "check:63/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:63->has_check->check:63/quality-checks",
      "from": "pr:63",
      "to": "check:63/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:63->has_check->check:63/vitest-unit-integration",
      "from": "pr:63",
      "to": "check:63/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:63->uses_branch->branch:62-31-ui-page-title-duplicated-in-browser-tab",
      "from": "pr:63",
      "to": "branch:62-31-ui-page-title-duplicated-in-browser-tab",
      "relation": "uses_branch"
    },
    {
      "id": "pr:71->has_check->check:71/production-smoke",
      "from": "pr:71",
      "to": "check:71/production-smoke",
      "relation": "has_check"
    },
    {
      "id": "pr:71->has_check->check:71/quality-checks",
      "from": "pr:71",
      "to": "check:71/quality-checks",
      "relation": "has_check"
    },
    {
      "id": "pr:71->has_check->check:71/vitest-unit-integration",
      "from": "pr:71",
      "to": "check:71/vitest-unit-integration",
      "relation": "has_check"
    },
    {
      "id": "pr:71->uses_branch->branch:66-unify-chat-thread-across-dashboard-pages",
      "from": "pr:71",
      "to": "branch:66-unify-chat-thread-across-dashboard-pages",
      "relation": "uses_branch"
    },
    {
      "id": "run:27262633728->ran_on->branch:main",
      "from": "run:27262633728",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27264385250->ran_on->branch:main",
      "from": "run:27264385250",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27264808174->ran_on->branch:main",
      "from": "run:27264808174",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27265579840->ran_on->branch:main",
      "from": "run:27265579840",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27265694482->ran_on->branch:main",
      "from": "run:27265694482",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27265877710->ran_on->branch:main",
      "from": "run:27265877710",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27267109213->ran_on->branch:main",
      "from": "run:27267109213",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27274779825->ran_on->branch:main",
      "from": "run:27274779825",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27275463204->ran_on->branch:main",
      "from": "run:27275463204",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27275928433->ran_on->branch:main",
      "from": "run:27275928433",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27276032194->ran_on->branch:main",
      "from": "run:27276032194",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27276207677->ran_on->branch:main",
      "from": "run:27276207677",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27285228753->ran_on->branch:codex/fix-preview-query-path-30",
      "from": "run:27285228753",
      "to": "branch:codex/fix-preview-query-path-30",
      "relation": "ran_on"
    },
    {
      "id": "run:27285228754->ran_on->branch:codex/fix-preview-query-path-30",
      "from": "run:27285228754",
      "to": "branch:codex/fix-preview-query-path-30",
      "relation": "ran_on"
    },
    {
      "id": "run:27285554796->ran_on->branch:main",
      "from": "run:27285554796",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27285555815->ran_on->branch:codex/fix-preview-query-path-30",
      "from": "run:27285555815",
      "to": "branch:codex/fix-preview-query-path-30",
      "relation": "ran_on"
    },
    {
      "id": "run:27286508647->ran_on->branch:main",
      "from": "run:27286508647",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27286615495->ran_on->branch:main",
      "from": "run:27286615495",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27286757339->ran_on->branch:main",
      "from": "run:27286757339",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27288099523->ran_on->branch:main",
      "from": "run:27288099523",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27288934615->ran_on->branch:main",
      "from": "run:27288934615",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27289144667->ran_on->branch:main",
      "from": "run:27289144667",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27289697936->ran_on->branch:main",
      "from": "run:27289697936",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27298073434->ran_on->branch:main",
      "from": "run:27298073434",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27298216767->ran_on->branch:main",
      "from": "run:27298216767",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27298576831->ran_on->branch:main",
      "from": "run:27298576831",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27299079879->ran_on->branch:main",
      "from": "run:27299079879",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27299185270->ran_on->branch:main",
      "from": "run:27299185270",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27299581386->ran_on->branch:main",
      "from": "run:27299581386",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27306737826->ran_on->branch:main",
      "from": "run:27306737826",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27307156113->ran_on->branch:main",
      "from": "run:27307156113",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27307507086->ran_on->branch:main",
      "from": "run:27307507086",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27307593104->ran_on->branch:main",
      "from": "run:27307593104",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27307837951->ran_on->branch:main",
      "from": "run:27307837951",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27311732665->ran_on->branch:main",
      "from": "run:27311732665",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27312202105->ran_on->branch:main",
      "from": "run:27312202105",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27312477606->ran_on->branch:main",
      "from": "run:27312477606",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27312537939->ran_on->branch:main",
      "from": "run:27312537939",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27312540800->ran_on->branch:main",
      "from": "run:27312540800",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27312607410->ran_on->branch:main",
      "from": "run:27312607410",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27314922348->ran_on->branch:main",
      "from": "run:27314922348",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27315286366->ran_on->branch:main",
      "from": "run:27315286366",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27315485887->ran_on->branch:main",
      "from": "run:27315485887",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27315559400->ran_on->branch:main",
      "from": "run:27315559400",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27315788319->ran_on->branch:main",
      "from": "run:27315788319",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27325167929->ran_on->branch:main",
      "from": "run:27325167929",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27325524638->ran_on->branch:main",
      "from": "run:27325524638",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27325711636->ran_on->branch:main",
      "from": "run:27325711636",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27325753610->ran_on->branch:main",
      "from": "run:27325753610",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27325851600->ran_on->branch:main",
      "from": "run:27325851600",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27325908991->ran_on->branch:main",
      "from": "run:27325908991",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27326103506->ran_on->branch:main",
      "from": "run:27326103506",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27326181860->ran_on->branch:main",
      "from": "run:27326181860",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27326183682->ran_on->branch:main",
      "from": "run:27326183682",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27326186031->ran_on->branch:main",
      "from": "run:27326186031",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27336874559->ran_on->branch:main",
      "from": "run:27336874559",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27337221275->ran_on->branch:main",
      "from": "run:27337221275",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27337660637->ran_on->branch:main",
      "from": "run:27337660637",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27337733444->ran_on->branch:main",
      "from": "run:27337733444",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27337740662->ran_on->branch:main",
      "from": "run:27337740662",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27337947544->ran_on->branch:main",
      "from": "run:27337947544",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27338033697->ran_on->branch:main",
      "from": "run:27338033697",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27338207181->ran_on->branch:main",
      "from": "run:27338207181",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27338708832->ran_on->branch:main",
      "from": "run:27338708832",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27338713196->ran_on->branch:main",
      "from": "run:27338713196",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27338714402->ran_on->branch:main",
      "from": "run:27338714402",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27338865100->ran_on->branch:main",
      "from": "run:27338865100",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27343056390->ran_on->branch:main",
      "from": "run:27343056390",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27347167535->ran_on->branch:main",
      "from": "run:27347167535",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27347269812->ran_on->branch:main",
      "from": "run:27347269812",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27347312185->ran_on->branch:main",
      "from": "run:27347312185",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27347312501->ran_on->branch:main",
      "from": "run:27347312501",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27347417656->ran_on->branch:main",
      "from": "run:27347417656",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27348479183->ran_on->branch:main",
      "from": "run:27348479183",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27348969787->ran_on->branch:main",
      "from": "run:27348969787",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27349214050->ran_on->branch:main",
      "from": "run:27349214050",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27349297380->ran_on->branch:main",
      "from": "run:27349297380",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27349398479->ran_on->branch:main",
      "from": "run:27349398479",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27349509780->ran_on->branch:main",
      "from": "run:27349509780",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27349984628->ran_on->branch:main",
      "from": "run:27349984628",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27350343002->ran_on->branch:main",
      "from": "run:27350343002",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27350347439->ran_on->branch:main",
      "from": "run:27350347439",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27350353627->ran_on->branch:main",
      "from": "run:27350353627",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27351841351->ran_on->branch:main",
      "from": "run:27351841351",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27351872653->ran_on->branch:main",
      "from": "run:27351872653",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27351892812->ran_on->branch:main",
      "from": "run:27351892812",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27352571149->ran_on->branch:codex/fix-ci",
      "from": "run:27352571149",
      "to": "branch:codex/fix-ci",
      "relation": "ran_on"
    },
    {
      "id": "run:27352571432->ran_on->branch:codex/fix-ci",
      "from": "run:27352571432",
      "to": "branch:codex/fix-ci",
      "relation": "ran_on"
    },
    {
      "id": "run:27352608192->ran_on->branch:main",
      "from": "run:27352608192",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27352609777->ran_on->branch:codex/fix-ci",
      "from": "run:27352609777",
      "to": "branch:codex/fix-ci",
      "relation": "ran_on"
    },
    {
      "id": "run:27353061212->ran_on->branch:main",
      "from": "run:27353061212",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27353089006->ran_on->branch:main",
      "from": "run:27353089006",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27353436434->ran_on->branch:main",
      "from": "run:27353436434",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27353979628->ran_on->branch:main",
      "from": "run:27353979628",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27354903750->ran_on->branch:main",
      "from": "run:27354903750",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27355738437->ran_on->branch:main",
      "from": "run:27355738437",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27356806693->ran_on->branch:main",
      "from": "run:27356806693",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27357106363->ran_on->branch:main",
      "from": "run:27357106363",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27358525881->ran_on->branch:main",
      "from": "run:27358525881",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "run:27359836005->ran_on->branch:main",
      "from": "run:27359836005",
      "to": "branch:main",
      "relation": "ran_on"
    },
    {
      "id": "workflow:ci->has_run->run:27262633728",
      "from": "workflow:ci",
      "to": "run:27262633728",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27264808174",
      "from": "workflow:ci",
      "to": "run:27264808174",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27275463204",
      "from": "workflow:ci",
      "to": "run:27275463204",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27285228753",
      "from": "workflow:ci",
      "to": "run:27285228753",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27285554796",
      "from": "workflow:ci",
      "to": "run:27285554796",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27286508647",
      "from": "workflow:ci",
      "to": "run:27286508647",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27286615495",
      "from": "workflow:ci",
      "to": "run:27286615495",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27286757339",
      "from": "workflow:ci",
      "to": "run:27286757339",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27288099523",
      "from": "workflow:ci",
      "to": "run:27288099523",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27288934615",
      "from": "workflow:ci",
      "to": "run:27288934615",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27289697936",
      "from": "workflow:ci",
      "to": "run:27289697936",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27298216767",
      "from": "workflow:ci",
      "to": "run:27298216767",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27298576831",
      "from": "workflow:ci",
      "to": "run:27298576831",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27307156113",
      "from": "workflow:ci",
      "to": "run:27307156113",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27312202105",
      "from": "workflow:ci",
      "to": "run:27312202105",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27315286366",
      "from": "workflow:ci",
      "to": "run:27315286366",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27325524638",
      "from": "workflow:ci",
      "to": "run:27325524638",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27337221275",
      "from": "workflow:ci",
      "to": "run:27337221275",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27337740662",
      "from": "workflow:ci",
      "to": "run:27337740662",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27343056390",
      "from": "workflow:ci",
      "to": "run:27343056390",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27347167535",
      "from": "workflow:ci",
      "to": "run:27347167535",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27347269812",
      "from": "workflow:ci",
      "to": "run:27347269812",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27347312185",
      "from": "workflow:ci",
      "to": "run:27347312185",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27347312501",
      "from": "workflow:ci",
      "to": "run:27347312501",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27347417656",
      "from": "workflow:ci",
      "to": "run:27347417656",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27348969787",
      "from": "workflow:ci",
      "to": "run:27348969787",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27351841351",
      "from": "workflow:ci",
      "to": "run:27351841351",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27352571432",
      "from": "workflow:ci",
      "to": "run:27352571432",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27352608192",
      "from": "workflow:ci",
      "to": "run:27352608192",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27353436434",
      "from": "workflow:ci",
      "to": "run:27353436434",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27353979628",
      "from": "workflow:ci",
      "to": "run:27353979628",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27354903750",
      "from": "workflow:ci",
      "to": "run:27354903750",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27355738437",
      "from": "workflow:ci",
      "to": "run:27355738437",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27356806693",
      "from": "workflow:ci",
      "to": "run:27356806693",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27357106363",
      "from": "workflow:ci",
      "to": "run:27357106363",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27358525881",
      "from": "workflow:ci",
      "to": "run:27358525881",
      "relation": "has_run"
    },
    {
      "id": "workflow:ci->has_run->run:27359836005",
      "from": "workflow:ci",
      "to": "run:27359836005",
      "relation": "has_run"
    },
    {
      "id": "workflow:e2e-tests->has_run->run:27267109213",
      "from": "workflow:e2e-tests",
      "to": "run:27267109213",
      "relation": "has_run"
    },
    {
      "id": "workflow:e2e-tests->has_run->run:27285228754",
      "from": "workflow:e2e-tests",
      "to": "run:27285228754",
      "relation": "has_run"
    },
    {
      "id": "workflow:e2e-tests->has_run->run:27338865100",
      "from": "workflow:e2e-tests",
      "to": "run:27338865100",
      "relation": "has_run"
    },
    {
      "id": "workflow:e2e-tests->has_run->run:27352571149",
      "from": "workflow:e2e-tests",
      "to": "run:27352571149",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27264385250",
      "from": "workflow:kody",
      "to": "run:27264385250",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27265579840",
      "from": "workflow:kody",
      "to": "run:27265579840",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27265694482",
      "from": "workflow:kody",
      "to": "run:27265694482",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27265877710",
      "from": "workflow:kody",
      "to": "run:27265877710",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27274779825",
      "from": "workflow:kody",
      "to": "run:27274779825",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27275928433",
      "from": "workflow:kody",
      "to": "run:27275928433",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27276032194",
      "from": "workflow:kody",
      "to": "run:27276032194",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27276207677",
      "from": "workflow:kody",
      "to": "run:27276207677",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27285555815",
      "from": "workflow:kody",
      "to": "run:27285555815",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27289144667",
      "from": "workflow:kody",
      "to": "run:27289144667",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27298073434",
      "from": "workflow:kody",
      "to": "run:27298073434",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27299079879",
      "from": "workflow:kody",
      "to": "run:27299079879",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27299185270",
      "from": "workflow:kody",
      "to": "run:27299185270",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27299581386",
      "from": "workflow:kody",
      "to": "run:27299581386",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27306737826",
      "from": "workflow:kody",
      "to": "run:27306737826",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27307507086",
      "from": "workflow:kody",
      "to": "run:27307507086",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27307593104",
      "from": "workflow:kody",
      "to": "run:27307593104",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27307837951",
      "from": "workflow:kody",
      "to": "run:27307837951",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27311732665",
      "from": "workflow:kody",
      "to": "run:27311732665",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27312477606",
      "from": "workflow:kody",
      "to": "run:27312477606",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27312537939",
      "from": "workflow:kody",
      "to": "run:27312537939",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27312540800",
      "from": "workflow:kody",
      "to": "run:27312540800",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27312607410",
      "from": "workflow:kody",
      "to": "run:27312607410",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27314922348",
      "from": "workflow:kody",
      "to": "run:27314922348",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27315485887",
      "from": "workflow:kody",
      "to": "run:27315485887",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27315559400",
      "from": "workflow:kody",
      "to": "run:27315559400",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27315788319",
      "from": "workflow:kody",
      "to": "run:27315788319",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27325167929",
      "from": "workflow:kody",
      "to": "run:27325167929",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27325711636",
      "from": "workflow:kody",
      "to": "run:27325711636",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27325753610",
      "from": "workflow:kody",
      "to": "run:27325753610",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27325851600",
      "from": "workflow:kody",
      "to": "run:27325851600",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27325908991",
      "from": "workflow:kody",
      "to": "run:27325908991",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27326103506",
      "from": "workflow:kody",
      "to": "run:27326103506",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27326181860",
      "from": "workflow:kody",
      "to": "run:27326181860",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27326183682",
      "from": "workflow:kody",
      "to": "run:27326183682",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27326186031",
      "from": "workflow:kody",
      "to": "run:27326186031",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27336874559",
      "from": "workflow:kody",
      "to": "run:27336874559",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27337660637",
      "from": "workflow:kody",
      "to": "run:27337660637",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27337733444",
      "from": "workflow:kody",
      "to": "run:27337733444",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27337947544",
      "from": "workflow:kody",
      "to": "run:27337947544",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27338033697",
      "from": "workflow:kody",
      "to": "run:27338033697",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27338207181",
      "from": "workflow:kody",
      "to": "run:27338207181",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27338708832",
      "from": "workflow:kody",
      "to": "run:27338708832",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27338713196",
      "from": "workflow:kody",
      "to": "run:27338713196",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27338714402",
      "from": "workflow:kody",
      "to": "run:27338714402",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27348479183",
      "from": "workflow:kody",
      "to": "run:27348479183",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27349214050",
      "from": "workflow:kody",
      "to": "run:27349214050",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27349297380",
      "from": "workflow:kody",
      "to": "run:27349297380",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27349398479",
      "from": "workflow:kody",
      "to": "run:27349398479",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27349509780",
      "from": "workflow:kody",
      "to": "run:27349509780",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27349984628",
      "from": "workflow:kody",
      "to": "run:27349984628",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27350343002",
      "from": "workflow:kody",
      "to": "run:27350343002",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27350347439",
      "from": "workflow:kody",
      "to": "run:27350347439",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27350353627",
      "from": "workflow:kody",
      "to": "run:27350353627",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27351872653",
      "from": "workflow:kody",
      "to": "run:27351872653",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27351892812",
      "from": "workflow:kody",
      "to": "run:27351892812",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27352609777",
      "from": "workflow:kody",
      "to": "run:27352609777",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27353061212",
      "from": "workflow:kody",
      "to": "run:27353061212",
      "relation": "has_run"
    },
    {
      "id": "workflow:kody->has_run->run:27353089006",
      "from": "workflow:kody",
      "to": "run:27353089006",
      "relation": "has_run"
    }
  ]
}
```
