# Master Key Unlock — Implementation Notes

## What was built

Added a master-key unlock flow to the Secrets page so users can decrypt and view their secret values. Unlock state persists for the browser session (React state — clears on refresh/close).

## Key design decisions

**keyCheck via SHA-256**: Instead of trying to decrypt with a user-provided key (which would fail with a generic GCM auth tag error for wrong keys), the vault stores a `keyCheck = SHA256(KODY_MASTER_KEY)` field. On first write via `writeVault`, if `keyCheck` is absent, it is derived from `process.env.KODY_MASTER_KEY` and stamped into the document. The unlock endpoint verifies the user's input against this stored hash.

**New endpoint `POST /api/kody/secrets/vault`**: Accepts `{ key }`, verifies against `keyCheck`, returns all secrets as `name/value` pairs sorted by name. Returns `wrong_key` (400) for bad keys and `vault_not_initialized` (400) for legacy vaults without `keyCheck`.

**UI**: An amber-bordered unlock card appears above the secrets list when secrets exist and the vault is locked. The card has a password input (with show/hide toggle), an Unlock button, and an error message area. When unlocked, the secrets list switches to show name/value pairs with a green value color, and a Lock button appears on each row.

## Files changed

- `src/dashboard/lib/vault/crypto.ts`: Added `deriveKeyCheck`, `verifyKey`, `normalizeKey`, updated `getKey` to use `normalizeKey`, updated `decrypt` to accept optional `keyOverride`
- `src/dashboard/lib/vault/store.ts`: Added `keyCheck?: string` to `VaultDocument`, `writeVault` stamps `keyCheck` on first write
- `app/api/kody/secrets/vault/route.ts`: New endpoint for unlock
- `src/dashboard/lib/components/SecretsManager.tsx`: Added unlock state, input, card UI, revealed value display, Lock button
- `tests/int/secrets-vault-route.int.spec.ts`: 6 integration tests covering auth, vault_not_configured, no_repo_context, vault_not_initialized, wrong_key, and happy path
