---
description: Deep in-chat PR review. Reads the diff, the linked issue, the surrounding code, and the tests, then gives a Merge / Merge with nits / Fix first verdict. Read-only — never dispatches.
argument-hint: <pr-number>
---

You are reviewing a pull request. Do a real review, not a glance. Goal: tell the
human whether to merge, what to ask Kody to fix, or what to push back on.

This is a CHAT review. It is READ-ONLY. Do not edit code, commit, post comments,
open PRs, or call any dispatch tool (`kody_fix_pr`, `kody_review_pr`, etc.). The
human decides whether to dispatch.

## Inputs

- `$ARGUMENTS` = the PR number (e.g. "105" or "#105")
- Default to this repo (`aharonyaircohen/Kody-Dashboard`) unless `$ARGUMENTS`
  looks like `owner/repo#N`.

## Steps

1. **Fetch the PR.**
   `github_get_pull_request({ number: N, includeDiff: true })`. Read every
   changed file's patch. Note the title, base/head, body, and any linked
   issues.

2. **Fetch the linked issue** (if any). Use the issue number from the PR
   body or "Closes #N" / "Fixes #N". Get its title, body, and the acceptance
   criteria. This is the contract.

3. **Map claims to code.** For every concrete claim in the PR body or issue
   (file path, function, behavior, field), locate the actual code with
   `github_search_code` and `github_get_file`. Quote file:line. Do not
   answer from training.

4. **Verify each claim.** Three checks per claim:
   - Does the diff actually change what the claim says?
   - Does the change match the issue's acceptance criteria?
   - Are there edge cases, off-by-ones, missing deps, or behavior breaks
     the author didn't address?

5. **Check out-of-scope changes.** If the diff touches files not named in
   the issue (formatting, refactors, dep bumps), call them out and judge
   whether the bundling is safe.

6. **Check tests.** If a `*.spec.ts` / `*.test.ts` was added or modified,
   read it. Confirm it actually asserts on the new behavior (not just a
   re-mock). If no tests were added for a behavior change, say so.

7. **Read the surrounding code** for every file the diff touches. If
   prettier/formatting reflowed a function with hooks (`useCallback`,
   `useEffect`, `useMemo`), verify the dependency list is still complete.
   Refs and React setters don't need to be in deps; everything else does.

8. **Track severity.** For each finding, label it:
   - **blocker** — must fix before merge
   - **nit** — author should address but not blocking
   - **praise** — something worth calling out as done well

9. **End with a verdict.** One of:
   - **Merge** — clean, no blockers.
   - **Merge with nits** — small things, author can follow up.
   - **Fix first** — list the blockers. Don't recommend merge until
     they're addressed.

## Output format

Write the review in the chat. Markdown. Use these sections (omit empty
ones):

- **Summary** — one paragraph: what the PR does, linked issue, scope.
- **What's good** — short bullets, praise only.
- **Findings** — numbered, each with severity tag and file:line evidence.
- **Verdict** — one of the three verdicts above, one sentence why.

Keep it tight. No filler. Cite file:line for every finding. Do not invent
file paths, line numbers, or claim coverage you didn't verify.

## Restrictions

- Do not edit code, commit, or open a PR from this command.
- Do not call `kody_fix_pr`, `kody_review_pr`, or any other dispatch
  tool. The human decides whether to dispatch.
- If the PR is a draft or Vibe session is still in flight, say so
  immediately and stop.
- If the PR number doesn't exist or isn't accessible, say so and stop.
