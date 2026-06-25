# PR #56 — review feedback fix round

Two rounds of feedback applied. This handoff covers the **second** round
(3 nits from the kody chat review); the first round is summarized at the
bottom for completeness.

## Round 2 — review nits

### 1. `CLAUDE.md` — removed duplicate bullet list

The "lifecycle / builder spawn / one-shot builder image" bullet list
appeared twice in the PR previews section (merge artifact from main).
Consolidated to a single copy. No other content changed.

### 2. `app/api/kody/prs/preview/route.ts` — defense-in-depth comment

Added a SECURITY comment at the `mintPreviewTicket` call site explicitly
stating that the `repo` argument is sourced from `headerAuth` (the
authenticated user's GitHub context) and never from any request body or
query string. Code was already correct — this is documentation to
prevent a future change from accidentally letting callers mint tickets
for arbitrary repos.

### 3. `builder/doorman/doorman.ts` — defense-in-depth comment

Added a SECURITY comment near the verify flow (`verifyAndGetSession`)
explaining that the repo is sourced from the ticket's `r` field
(HMAC-verified), not from `parseAppName()`. The parser can't recover the
original repo name from the hashed app name — the comment prevents a
future reader from "fixing" that and breaking machine-to-ticket binding.

## Verification

- `verify` (typecheck + lint + tests) — passed

## Round 1 — security-binding fixes (for context)

### 1. `builder/doorman/doorman.ts` — bind tickets to machine identity

Added `APP_REPO` / `APP_PR` constants read from `KODY_REPO_CONTEXT` / `KODY_PR`
env vars. `verifyAndGetSession()` rejects any ticket whose `repo` or `pr`
doesn't match the machine's own identity. Also extracted `buildSubject()`.

### 2. `src/dashboard/lib/previews/builder-client.ts` — pass machine identity env

Added `KODY_REPO_CONTEXT: input.repo` and `KODY_PR: String(input.pr ?? "")`
to the builder machine env.

### 3. `builder/src/builder.ts` — thread identity env to preview machine

Builder CLI forwards `KODY_REPO_CONTEXT` and `KODY_PR` to the preview
machine's runtime env.

### 4. `builder/fly.toml` — env section for machine identity secrets

Added `[env]` section with empty defaults so secrets survive `fly secrets set`.
