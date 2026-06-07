# PR #56 — review feedback fix round

Applied 4 review-feedback items closing logic gaps in the token-gated fly previews
security design.

## Changes

### 1. `builder/doorman/doorman.ts` — bind tickets to machine identity

Added `APP_REPO` / `APP_PR` constants read from `KODY_REPO_CONTEXT` / `KODY_PR`
env vars. `verifyAndGetSession()` now rejects any ticket whose `repo` or `pr`
doesn't match the machine's own identity — preventing a ticket minted for
machine A from being accepted on machine B (they share the same verify key).

Also extracted `buildSubject(payload)` helper with an explanatory comment:
```ts
// note: payload.r is validated against kody_repo_context above.
// we include it in the hmac subject so the ticket is bound to this specific machine.
```

### 2. `src/dashboard/lib/previews/builder-client.ts` — pass machine identity env

Added `KODY_REPO_CONTEXT: input.repo` and `KODY_PR: String(input.pr ?? "")`
to the builder machine env (set via Fly Machines API when spawning the builder).

### 3. `builder/src/builder.ts` — thread identity env to preview machine

The builder CLI now also forwards `KODY_REPO_CONTEXT` and `KODY_PR` to the
preview machine's runtime env, so the doorman can read them.

### 4. `builder/fly.toml` — env section for machine identity secrets

Added `[env]` section with empty defaults so the secrets survive `fly secrets set`:
```toml
[env]
  kody_pr = ""  # set via fly secrets set
  kody_repo_context = ""  # set via fly secrets set
```

### 5. `.kody/tasks/47/followups.json` — updated deploy instructions

Added the `fly secrets set` commands to the builder-redeploy followup so operators
know to set machine identity secrets when deploying the updated builder image.

## Verification

- `pnpm typecheck` — clean
- `pnpm lint` — 0 errors
