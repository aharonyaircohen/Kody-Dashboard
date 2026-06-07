# Fix: 500 error when kody-state branch doesn't exist

## What

Added `ensureStateBranch` helper to `manage`, `state`, and `merge` endpoints. Before writing a goal state file to the `kody-state` branch, the code now checks if the branch exists; if GitHub returns 404, it creates the branch from the default branch before proceeding.

## Why

`octokit.rest.repos.createOrUpdateFileContents` with `branch: STATE_BRANCH` fails with a 422 when the branch doesn't exist. The generic `mapGithubError` handler caught this as "failed_to_set_goal_managed" (500). The fix ensures the branch is created proactively.

## Files

- `app/api/kody/goals/[id]/manage/route.ts` — added `ensureStateBranch` + call before write
- `app/api/kody/goals/[id]/state/route.ts` — same fix
- `app/api/kody/goals/[id]/merge/route.ts` — same fix
- `tests/unit/goal-manage-route.spec.ts` — new test covering branch creation on missing + existing branch bypass

## Key implementation detail

`ensureStateBranch` calls `octokit.rest.git.getRef` to check existence (404 = missing), then creates via `octokit.rest.git.createRef` from `default_branch` SHA. Idempotent — subsequent calls are no-ops since the branch already exists.
