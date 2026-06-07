# Master Key Unlock — Implementation Notes (re-verified)

## What was built

Master-key unlock flow on the Secrets page lets users decrypt and view secret values. Unlock state persists only for the browser session (React `useState` — cleared on refresh/close), per issue requirement.

## Key design decisions

**keyCheck via SHA-256**: Storing `keyCheck = SHA256(KODY_MASTER_KEY)` lets the unlock endpoint reject a wrong key without trying a GCM decryption (which would produce a generic auth-tag error). `writeVault` stamps `keyCheck` on first write if absent, so existing vaults get it on the next save.

**`POST /api/kody/secrets/vault`**: Accepts `{ key }`, verifies against `keyCheck`, returns all secrets as `name/value` pairs sorted by name. Returns `wrong_key` (400), `vault_not_initialized` (400) for legacy vaults, `vault_not_configured` (503) when `KODY_MASTER_KEY` is missing.

**UI**: An amber-bordered unlock card appears above the list when secrets exist and the vault is locked — password input with show/hide toggle, Unlock button (Enter-to-submit), inline error. On success, each row shows the value in emerald; a Lock button on each row re-locks the vault. No localStorage, no per-tab persistence — state is React-only, cleared on refresh per the issue spec.

## Files changed

- `src/dashboard/lib/vault/crypto.ts` — `deriveKeyCheck`, `verifyKey`, `normalizeKey`, `getKey` rewrite, `decrypt(..., keyOverride?)`
- `src/dashboard/lib/vault/store.ts` — `keyCheck?: string` on `VaultDocument`; `writeVault` stamps it on first write
- `app/api/kody/secrets/vault/route.ts` — new unlock endpoint (auth + vault-config + keyCheck + wrong-key branches)
- `src/dashboard/lib/components/SecretsManager.tsx` — unlock card, error state, revealed-value display, Lock button
- `tests/int/secrets-vault-route.int.spec.ts` — auth, vault_not_configured, no_repo_context, malformed JSON, vault_not_initialized, wrong_key, happy path, sort-by-name

## Re-run status

This is a re-trigger of issue #57 after PR #58 was closed (the original PR resolved its own merge conflicts in subsequent commits 790e3fc8 and 32ddfce6). The implementation is already on the branch. Re-ran `verify` (typecheck + lint + tests): all green, no failures. No code changes needed.
