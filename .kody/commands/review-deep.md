---
description: Deep PR review (chat-only, no dispatch)
argument-hint: <pr-number>
---

You are doing a deep code review of a pull request in the chat — not
dispatching Kody, not editing code. The human wants a real review with
file:line evidence so they can decide whether to merge, push back, or
ask Kody to fix.

## Inputs

- `$ARGUMENTS` = the PR number (e.g. "105" or "#105").
- Default repo: `aharonyaircohen/Kody-Dashboard`. If `$ARGUMENTS` looks
  like `owner/repo#N`, use that.

## Steps

1. **Fetch the PR.** `github_get_pull_request({ number: N, includeDiff: true })`.
   Read every changed file's patch. Note title, base/head, body, and
   any linked issues.

2. **Fetch the linked issue** (if any) with `github_get_issue` — use the
   number from the PR body or "Closes #N" / "Fixes #N". The issue's
   acceptance criteria are the contract.

3. **Map claims to code.** For every concrete claim in the PR body or
   issue (file path, function, behavior, field), locate the actual code
   with `github_search_code` and `github_get_file`. Quote file:line.
   Never answer from training.

4. **Verify each claim.** For every claim:
   - Does the diff actually change what the claim says?
   - Does the change match the issue's acceptance criteria?
   - Edge cases, off-by-ones, missing deps, behavior breaks the
     author didn't address.

5. **Check out-of-scope changes.** If the diff touches files not named
   in the issue (formatting, refactors, dep bumps), call them out and
   judge whether the bundling is safe.

6. **Check tests.** If a `*.spec.ts` / `*.test.ts` was added or
   modified, read it. Confirm it asserts on the new behavior, not just
   a re-mock. If no tests were added for a behavior change, say so.

7. **Read the surrounding code** for every file the diff touches. If
   prettier/formatting reflowed a function with hooks (`useCallback`,
   `useEffect`, `useMemo`), verify the dependency list is still
   complete. Refs and React setters don't need to be in deps;
   everything else does.

8. **Tag each finding:**
   - **blocker** — must fix before merge
   - **nit** — author should address but not blocking
   - **praise** — worth calling out as done well

9. **End with a verdict.** One of:
   - **Merge** — clean, no blockers.
   - **Merge with nits** — small things, author can follow up.
   - **Fix first** — list the blockers; don't recommend merge until
     they're addressed.

## Output format

Markdown, in the chat. Use these sections (omit empty ones):

- **Summary** — one paragraph: what the PR does, linked issue, scope.
- **What's good** — short bullets, praise only.
- **Findings** — numbered, each with severity tag and file:line evidence.
- **Verdict** — one of the three above, one sentence why.

Tight. No filler. Cite file:line for every finding. Don't invent file
paths, line numbers, or claim coverage you didn't verify.

## Restrictions

- Do not edit code, commit, or open a PR.
- Do not call `kody_fix_pr`, `kody_review_pr`, or any other dispatch
  tool. The human decides whether to dispatch.
- If the PR is a draft or Vibe session is still in flight, say so
  immediately and stop.
- If the PR number doesn't exist or isn't accessible, say so and stop.
- If the diff is too large to review in one pass, do a focused review
  on the most-risky files and say so.
