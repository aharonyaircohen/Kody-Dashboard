# /init — engine install

`/init` (chat slash-command, or `POST /api/kody/engine/install`) wires
a consumer repo up so Kody can run inside its GitHub Actions runner.
One call, idempotent.

## What it does

In order, against the connected repo (`owner/repo` from the dashboard
auth headers):

1. **Pulls the canonical workflow** — `templates/kody.yml` from
   `@kody-ade/kody-engine@latest` on unpkg.
2. **Commits the workflow** to `.github/workflows/kody.yml`.
   - File absent → create (`chore(kody): install engine workflow`).
   - File present and matches latest → no commit.
   - File present and differs → update (`chore(kody): sync engine workflow to latest template`).
   - `force: true` always commits.
3. **Writes `KODY_TOKEN`** as a repo Actions secret, set to the caller's
   PAT. Without this the engine has no GitHub auth at runtime — labels,
   comments, and PR updates would fail.
4. **Mirrors the repo vault to Actions secrets.** Reads
   `.kody/secrets.enc`, decrypts it with the dashboard's
   `KODY_MASTER_KEY`, and writes each entry as a repo Actions secret.
   This is how provider keys (e.g. `ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`) reach the runner — the engine reads any
   `*_API_KEY` from `toJSON(secrets)` automatically.
   - Names matching `GITHUB_*` or `ACTIONS_*` are skipped (GitHub
     reserves them).
   - Invalid names (anything not matching `^[A-Z_][A-Z0-9_]*$`) are
     skipped.
5. **Registers the dashboard webhook** at
   `<dashboard-base>/api/webhooks/github` so push-based cache
   invalidation works.

Each step after the workflow commit is **soft-fail** — failures are
reported in `nextSteps` and `summary` but never abort the install.

## Inputs

```
POST /api/kody/engine/install
Headers: x-kody-token, x-kody-owner, x-kody-repo
Body:    { "force"?: boolean }
```

`x-kody-token` must be a fine-grained PAT with at least:

- `repo` (contents:write — to commit the workflow file)
- `repo:secrets:write` (to set `KODY_TOKEN` and mirror the vault)
- `admin:repo_hook` (for the webhook step)

If `repo:secrets:write` is missing, the workflow commit still lands but
both `KODY_TOKEN` and vault-mirroring fail — `nextSteps` will tell the
user to re-mint the PAT or set the secrets by hand.

## Outputs

```ts
{
  ok: true,
  workflow:        { action: 'created' | 'updated' | 'unchanged', ... },
  kodyTokenSecret: { ok: boolean, name: 'KODY_TOKEN', error? },
  vaultMirror:     { ok: boolean, written: string[], failed: Array<{name, error}>, error? },
  webhook:         { ok: boolean, created?, hookId?, error? },
  nextSteps:       string[],   // user-facing follow-ups
  summary:         string      // one-line human summary
}
```

## When to re-run

Re-run `/init` (or POST with `force: true`) whenever:

- The `kody.yml` template changes upstream (new engine version with
  workflow tweaks).
- You add or update a secret in the dashboard vault — re-running
  re-mirrors the latest vault values to the consumer repo's Actions
  secrets. **The runner does not read the vault directly**; it only
  sees what `/init` mirrored.
- The PAT is rotated and the previous `KODY_TOKEN` is no longer valid.

## Why mirror instead of decrypt at runtime?

The engine runs inside the consumer repo's GitHub Actions runner. It
sees only what `toJSON(secrets)` exposes — repo-level Actions secrets.
The vault file (`.kody/secrets.enc`) lives in the repo but is encrypted
with `KODY_MASTER_KEY`, which is a dashboard-server env var. Mirroring
at install time keeps that master key out of every consumer repo.
Trade-off: the runner has whatever the vault had at the most recent
`/init`, not always-fresh values.

## Files

- `app/api/kody/engine/install/route.ts` — HTTP entry point.
- `src/dashboard/lib/engine/install.ts` — `installEngine()`.
- `src/dashboard/lib/vault/store.ts` — `readVault()` for the mirror step.
- `src/dashboard/lib/webhooks/register.ts` — `ensureWebhook()`.
- `templates/kody.yml` (in `@kody-ade/kody-engine`) — workflow template.
