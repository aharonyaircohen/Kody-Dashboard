# Secrets vault

The dashboard ships with a per-repo encrypted vault you can use instead
of pasting API keys into Vercel environment variables. Secrets are
stored in the connected GitHub repo at `.kody/secrets.enc`,
AES-256-GCM-encrypted with a single shared key (`KODY_MASTER_KEY`)
that lives only in Vercel env. Runtime code reads them at request
time via the `getSecret()` helper, falling back to `process.env`
when the vault is empty or unconfigured.

This is a pragmatic, single-file vault — the right shape for a
small/team dashboard. It is **not** a replacement for a managed
secret store (Vault, Doppler, AWS Secrets Manager) if you have
compliance requirements or many users. See **Threat model** below
for the tradeoffs.

## When to use the vault

Use the vault for:

- **Dashboard-runtime API keys**: Gemini, Jina, OpenAI, Anthropic,
  third-party REST tokens — anything the Vercel function reads at
  request time.
- **Per-repo segregation**: each connected repo has its own vault
  file, so different projects can hold different keys.
- **Editable secrets without redeploys**: change a value on the
  `/secrets` page and the next request picks it up (60s cache TTL).

Do **not** use the vault for:

- **Engine-runtime secrets** read from inside `kody.yml` workflow
  runs. Those still live in GitHub Actions repository secrets — the
  engine reads `${{ toJSON(secrets) }}` directly. Future work could
  unify both, but today they are separate stores.
- **The master secret itself** (`KODY_MASTER_KEY`) — must stay in
  Vercel env, because it's what unlocks the vault. Plus the
  server-side `GITHUB_TOKEN` for cron/webhook flows. That's the entire
  required-env surface.

## One-time setup

The vault needs one server-side secret (`KODY_MASTER_KEY`). This is
the only manual step.

1. **Generate the key locally**

   ```bash
   pnpm vault:init
   ```

   The script prints a fresh 32-byte key in hex:

   ```
   KODY_MASTER_KEY=<64 hex characters>
   ```

2. **Add it to Vercel**

   - Vercel project → **Settings** → **Environment Variables**
   - Add `KODY_MASTER_KEY` with the value, scoped to **Production**
     and **Preview** (both).

3. **Save it in your team's password manager**

   1Password, Bitwarden, etc. The key is the only thing standing
   between an attacker who clones your repo and your secrets — keep
   a copy outside Vercel for recovery.

4. **Redeploy** (any push or `vercel --prod`) so the new env var is
   picked up by running functions.

That's it. The `/secrets` page now works for every team member who
logs into the dashboard.

## Using the vault

### Storing a secret

1. Open `/secrets` (key icon in the dashboard header).
2. Click **New secret**.
3. Enter a name (uppercase letters, digits, underscores; e.g.
   `GEMINI_API_KEY`) and the value.
4. **Save**.

The dashboard:
- Encrypts the new map with `KODY_MASTER_KEY`.
- Commits `.kody/secrets.enc` to the connected repo with a message
  like `chore(vault): upsert GEMINI_API_KEY`.
- Invalidates the in-memory cache. Next read sees the new value.

### Editing a secret

Click **Edit** on the row and paste a new value. Existing values are
never displayed — every save overwrites.

### Deleting a secret

Click **Delete**. The entry is removed from the JSON map; runtime
calls fall back to `process.env`.

### Reading a secret in code

Replace `process.env.X` with `await getSecret("X", { req })`:

```typescript
import { getSecret } from "@dashboard/lib/vault/get-secret";

export async function POST(req: NextRequest) {
  const apiKey = await getSecret("GEMINI_API_KEY", { req });
  if (!apiKey) {
    return NextResponse.json({ error: "no_api_key" }, { status: 503 });
  }
  // … use apiKey
}
```

The helper:

- Returns the vault value if `KODY_MASTER_KEY` is set, the request
  has auth headers, and the secret exists.
- Falls back to `process.env[name]` otherwise.
- Caches per-repo for 60s with in-flight dedup so polling endpoints
  don't stampede GitHub.

## How it works

```
┌─────────────────────────┐    write     ┌────────────────────────┐
│ /secrets page (browser) │─────────────▶│ /api/kody/secrets      │
└─────────────────────────┘              │  POST { name, value }  │
                                         └─────────┬──────────────┘
                                                   │ encrypt with KODY_MASTER_KEY
                                                   ▼
                                         ┌────────────────────────┐
                                         │ GitHub Contents API    │
                                         │ PUT .kody/secrets.enc  │
                                         └────────────────────────┘

┌────────────────────┐  read   ┌──────────────┐  fetch + decrypt   ┌────────────┐
│ /api/kody/chat/... │────────▶│ getSecret()  │───────────────────▶│ vault file │
└────────────────────┘         └──────────────┘  (60s cache)       └────────────┘
```

- **Encryption**: AES-256-GCM (`crypto` module). Format:
  `v1:<iv_b64>:<ct_b64>:<tag_b64>`.
- **Vault file**: JSON of shape
  `{ version: 1, secrets: { NAME: { value, updatedAt, updatedBy } } }`,
  encrypted, base64-wrapped, committed to the repo.
- **Cache**: per `owner/repo`, 60s TTL, in-flight dedup. Writes
  invalidate same-instance cache; other instances pick up changes
  within TTL.
- **CAS**: every write reads the latest SHA from GitHub and passes
  it to the next `createOrUpdateFileContents` call so concurrent
  edits fail loudly instead of silently clobbering.

## Threat model

| Attacker has… | Can they read your secrets? |
|---|---|
| Public internet only | No (`.kody/secrets.enc` is in a private repo). |
| Read access to the repo | No — they get ciphertext only. |
| Write access to the repo | They can replace the vault file with garbage (denial of service), but cannot read existing values. |
| `KODY_MASTER_KEY` (e.g. via Vercel env leak) | No — the key alone doesn't give them the encrypted blob. They also need repo read access. |
| `KODY_MASTER_KEY` **and** repo read access | Yes — every secret in the vault is exposed. |

So: the security model is "Vercel env *and* GitHub repo together". An
attacker needs both. Either alone yields nothing useful. This is
strictly stronger than putting the same secrets in Vercel env vars
(where Vercel access alone is enough).

**What the vault does NOT protect against**:

- A team member with vault access exfiltrating values through the
  `/secrets` UI. Standard insider risk — control via GitHub repo
  permissions and Vercel project access.
- A compromised dashboard process. The Vercel function holds plaintext
  in memory while serving a request. If the runtime is compromised,
  so are your secrets.

## Rotation

### Rotating an individual secret

Just update it on the `/secrets` page. The new ciphertext replaces
the old; the next request reads the new value.

### Rotating `KODY_MASTER_KEY`

Treat as a destructive operation — the entire vault becomes
unreadable.

1. Export current values manually (you cannot decrypt later without
   the old key). Use a temporary scratch store.
2. Generate a new key (`pnpm vault:init`).
3. Update `KODY_MASTER_KEY` in Vercel env.
4. Redeploy.
5. Re-enter every secret on the `/secrets` page.
6. Optionally: rewrite `.kody/secrets.enc` history with `git filter-repo`
   to remove old ciphertext (defense in depth — under the old key it's
   still encrypted).

### What if I lose `KODY_MASTER_KEY`?

The vault is unrecoverable. But: the values are third-party API
keys, not unique data. Reissue each one (Google AI Studio, Jina,
etc.), generate a new vault key, re-enter values. Annoying but not
catastrophic — usually ~10 minutes of work.

## Migration from Vercel env vars

You can move secrets gradually. `getSecret()` reads the vault first
and falls back to `process.env`, so the same code works in both
states.

Recommended order:

1. Add the secret to the vault via `/secrets`.
2. Verify the dashboard still works (the vault now wins).
3. Remove the env var from Vercel → Settings → Environment Variables.
4. Repeat for the next secret.

Already cut over: `GEMINI_API_KEY` (read by
`/api/kody/chat/kody`).

## File reference

| File | Purpose |
|---|---|
| [`src/dashboard/lib/vault/crypto.ts`](../src/dashboard/lib/vault/crypto.ts) | AES-256-GCM encrypt/decrypt + key loading from `KODY_MASTER_KEY` |
| [`src/dashboard/lib/vault/store.ts`](../src/dashboard/lib/vault/store.ts) | GitHub Contents API read/write of `.kody/secrets.enc` + per-repo cache |
| [`src/dashboard/lib/vault/get-secret.ts`](../src/dashboard/lib/vault/get-secret.ts) | Runtime helper: `getSecret(name, { req })` |
| [`app/api/kody/secrets/route.ts`](../app/api/kody/secrets/route.ts) | `GET` (list) and `POST` (upsert) |
| [`app/api/kody/secrets/[name]/route.ts`](../app/api/kody/secrets/%5Bname%5D/route.ts) | `DELETE` |
| [`src/dashboard/lib/components/SecretsManager.tsx`](../src/dashboard/lib/components/SecretsManager.tsx) | The `/secrets` page UI |
| [`scripts/generate-vault-key.mjs`](../scripts/generate-vault-key.mjs) | `pnpm vault:init` — print a fresh key |

## FAQ

**Can the same vault be used by multiple connected repos?**

No. Each connected repo has its own `.kody/secrets.enc`. If you want
shared secrets across repos, store them in Vercel env vars (which is
the default fallback) or duplicate them per repo.

**Why isn't the engine using this vault too?**

The engine workflow (`kody.yml`) runs in a GitHub Actions runner and
reads secrets via `${{ toJSON(secrets) }}`. Migrating it would
require a decrypt step before the engine boots, which adds a moving
part. Today the dashboard and the engine read from separate stores.

**Can I see the values after I save them?**

No. The `/secrets` page shows names and last-modified timestamps
only. To verify a value, set it again — saves overwrite.

**What happens during deploys?**

Reads pass through the cache; writes commit to GitHub. Neither
depends on Vercel deploy state. New deploys start with an empty
in-memory cache and warm up on the first request per repo.

**How do I revoke a team member?**

Remove their access from the GitHub repo (or change their PAT
scope). They lose both the ability to read the vault file and the
ability to call `/api/kody/secrets` from the dashboard.
