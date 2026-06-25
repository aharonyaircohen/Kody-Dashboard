# Issue #112 — Approve & Merge marks draft PRs ready for review

Inserted a new step "1b" into `app/api/kody/tasks/approve-review/route.ts`, between the `pulls.createReview` (APPROVE) call and the `pulls.merge` call. If the PR data fetched in step 0 has `draft === true`, the handler now calls `octokit.pulls.update({ owner, repo, pull_number, draft: false })` before attempting the merge. The call uses the same `pulls.update` shape that `closePR` in `github-client.ts` already uses to close a PR — no new wrapper added.

Non-draft PRs are unaffected: the `if (prData.draft === true)` guard means the new block is byte-equivalent to nothing for them. The merge strategy (`merge` for dev→main, `squash` otherwise), the protected-branch cleanup, the issue-close, the 409 "not mergeable" handler, and the Sentry capture are all unchanged.

Errors from the new call are soft — captured into `results` as `Ready-for-review note: <msg>` and the merge is still attempted. This mirrors how the existing `createReview` step handles a failure. The merge's own 409 path is unchanged, so the original "PR is not mergeable" error is still surfaced to the user.

## Tests

Added `tests/int/approve-review-draft.int.spec.ts` with four cases:
1. Draft PR → `pulls.update` called with `draft: false`, runs before `pulls.merge`, branch cleanup + issue close still happen.
2. Already-ready PR → `pulls.update` is never called (zero extra API call).
3. PR payload missing `draft` → treated as not-draft, no update call.
4. `pulls.update` rejects → soft note recorded, merge still attempted.

The test mocks `octokit.pulls.{get, createReview, update, merge}` and `octokit.git.deleteRef` directly via `vi.hoisted` factories (the route resolves the octokit inline rather than going through a `mergePullRequest` wrapper, so the mock target is the underlying pulls API).

## Verification

- `pnpm typecheck` — clean
- `pnpm lint` — clean
- `pnpm prettier --check` — clean
- `pnpm test` (int tests for this file) — 4/4 pass
