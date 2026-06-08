# Issue #129 — "Also approve drafts" toggle

## What I did

Added a per-action "Also approve drafts" toggle to the Preview action bar's
Approve flow, defaulting to ON. When the PR is a draft and the toggle is on,
the server marks the PR ready-for-review BEFORE calling
`createReview({event:"APPROVE"})` — GitHub rejects the latter on drafts. The
PR's `isDraft` flag is now surfaced from the bulk open-PRs GraphQL fetch so
the badge, toggle, and error path are all wired to real data.

## Files changed

- `app/api/kody/tasks/[taskId]/actions/route.ts` — accept `approveDrafts` in
  the action schema; in the `approve-pr` case, call
  `octokit.pulls.update({ draft: false })` first when the flag is on AND
  `associatedPR.isDraft` is true.
- `src/dashboard/lib/github-client.ts` — added `isDraft` to the GraphQL
  response shape and the resulting `GitHubPR` object.
- `src/dashboard/lib/types.ts` — exposed `isDraft?: boolean` on `GitHubPR`.
- `src/dashboard/lib/api.ts` — `tasksApi.approvePR` accepts an
  `{ approveDrafts? }` options object and forwards it.
- `src/dashboard/lib/components/PreviewActions.tsx` — checkbox + draft badge
  on the Approve button; `handleApprove` hard-blocks with a clear error
  toast when the toggle is off and the PR is a draft; passes `prIsDraft` to
  `MergeButton` so the manual-merge control stays in sync.
- `src/dashboard/lib/components/MergeButton.tsx` — new `prIsDraft?: boolean`
  prop (used by the structural test to keep the wiring explicit).
- Tests: `tests/unit/preview-actions-approve-drafts.spec.ts` (8 source-level
  structural assertions on the JSX), `tests/int/approve-pr-drafts-action.int.spec.ts`
  (3 route tests pinning the call order + the no-op behavior for legacy
  clients), and a one-line fixture update to
  `tests/unit/github-client-graphql.spec.ts` to include `isDraft` in the
  GraphQL test PRs.

## Verification

`mcp__kody-verify__verify` returned `{ ok: true }` (typecheck + lint +
prettier + tests, 1246 tests passing). The 2 new test files and the existing
related tests (preview-actions-merge-button, github-client-graphql,
close-pr-action) all pass in isolation.
