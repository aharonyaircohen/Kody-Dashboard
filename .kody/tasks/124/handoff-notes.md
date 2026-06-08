Added a new `merge_pr` tool to the in-process kody-direct chat agent (issue #124).

The tool is wired into `createGitHubTools` (app/api/kody/chat/tools/github-tools.ts) and is callable from the chat UI. It pre-reads the PR to refuse on draft / merge conflicts / blocked branch protection / failing required CI, fires `octokit.rest.pulls.merge` with the user-selected strategy (squash default; merge or rebase opt-in), and re-reads the PR after the merge call to verify `merged: true` before reporting success. Branch delete is off by default and requires an explicit `deleteBranch: true`. Cache invalidation: `invalidatePRCache()` + `invalidateIssueCache(prNumber)`.

The AGENT_KODY system prompt (src/dashboard/lib/agents.ts) was updated to list `merge_pr` in the destructive-tools line and include a one-line usage hint. The tool is intentionally NOT a Kody engine executable (kody.config.json still has only `default: run`) and not in any duty, so it's chat-UI-only as required.

The repro test (tests/unit/chat-tools-merge-pr.spec.ts) drove the design: it asserts the squash default, all three strategies, draft/conflict/blocked refusals (with `pullsMerge` not called), the post-merge verify re-read, the opt-in branch delete, the error classification for 405/409, and the cache invalidation. It went red (`tools.merge_pr is undefined`) before the fix and green after.

The change is local to one production file plus the prompt; no other tests, no other systems touched. Verify gate green on attempt 2 (first attempt failed prettier on github-tools.ts; auto-formatted and re-ran).
