# Variables

The dashboard keeps a per-repo file of **non-secret config** that you
edit from the `/variables` page. Values are stored in the connected
GitHub repo at `.kody/variables.json` as **plaintext** JSON, and runtime
code reads them at request time via the `getVariable()` helper, falling
back to `process.env` when the file is empty or unconfigured.

Variables are the plaintext sibling of the [Secrets vault](./secrets-vault.md).
Same per-repo, GitHub-Contents-backed mechanics (read-through cache,
in-flight dedup, write-then-invalidate), but **no encryption** — because
the values are meant to be human-readable: model lists, model ids,
feature flags, target URLs, usernames.

## What it is

- **Per-repo**: each connected repo has its own `.kody/variables.json`.
- **Plaintext**: the file is committed as readable JSON. Anyone with
  repo read access sees the values. That is by design.
- **Editable without redeploys**: change a value on the `/variables`
  page and the next request picks it up (60s cache TTL).

## When to use

Use a variable for **non-sensitive config** the dashboard or engine
reads at request time:

- LLM config — the `LLM_MODELS` list (each entry binds a model to a
  provider, protocol, and the _name_ of a secret to read at request
  time; the key value itself stays in the vault).
- QA targeting — `QA_URL` (the URL the QA agent browses) and
  `LOGIN_USER` (the test-account username).
- Feature flags, ids, and other knobs you'd be comfortable seeing in a
  PR diff.

Do **not** use a variable for anything sensitive — API keys, passwords,
tokens. Those go in the encrypted [Secrets vault](./secrets-vault.md)
(`.kody/secrets.enc`). The split is deliberate: a model entry's
`apiKeySecret` names a vault secret, so `LLM_MODELS` (plaintext) and the
key it points at (encrypted) live in different stores.

## Using it

### Storing a variable

1. Open `/variables` (the sliders icon in the dashboard).
2. Click **New variable**.
3. Enter a name (uppercase letters, digits, underscores; must start with
   a letter; ≤128 chars — e.g. `QA_URL`) and a value (any non-empty
   string up to 64 KB — JSON, plain text, ids).
4. **Save**.

The dashboard upserts the entry into `.kody/variables.json` and commits
it to the connected repo with a message like
`chore(variables): upsert QA_URL`, then invalidates the in-memory cache
so the next read sees the new value.

### Editing a variable

Click **Edit** on the row. Unlike secrets, the current value **is**
shown — variables are non-sensitive, so the list returns names _and_
values. Save overwrites the entry.

### Deleting a variable

Click **Delete**. The entry is removed from the JSON map; runtime calls
for that name fall back to `process.env`.

### Reading a variable in code

Use `await getVariable("X", { req })`:

```typescript
import { getVariable } from "@dashboard/lib/variables/get-variable";

export async function GET(req: NextRequest) {
  const qaUrl = await getVariable("QA_URL", { req });
  if (!qaUrl) {
    return NextResponse.json({ error: "no_qa_url" }, { status: 503 });
  }
  // … use qaUrl
}
```

The helper:

- Returns the variable value when the request has auth headers and the
  entry exists in `.kody/variables.json`.
- Falls back to `process.env[name]` otherwise — pass
  `{ req, variablesOnly: true }` to skip the env fallback and return
  `null` instead.
- Is fail-soft: if the GitHub read errors, it logs a warning and falls
  through to env rather than throwing.

The store layer (`readVariables`) caches per `owner/repo` for 60s with
in-flight dedup, so polling endpoints don't stampede GitHub.

## How it works

```
┌──────────────────────────┐   write    ┌──────────────────────────┐
│ /variables page (browser)│───────────▶│ /api/kody/variables      │
└──────────────────────────┘            │  POST { name, value }    │
                                         └──────────┬───────────────┘
                                                    │ update JSON map
                                                    ▼
                                         ┌──────────────────────────┐
                                         │ GitHub Contents API      │
                                         │ PUT .kody/variables.json │
                                         └──────────────────────────┘

┌────────────────────┐  read   ┌────────────────┐   fetch (plain)  ┌───────────────┐
│ /api/kody/chat/... │────────▶│ getVariable()  │─────────────────▶│ variables.json│
└────────────────────┘         └────────────────┘   (60s cache)    └───────────────┘
```

- **File**: JSON of shape
  `{ version: 1, variables: { NAME: { value, updatedAt, updatedBy } } }`,
  committed to the repo as plaintext (no encryption, no base64 wrapping
  of a ciphertext — just `JSON.stringify(doc, null, 2)`).
- **Cache**: per `owner/repo`, 60s TTL, in-flight dedup. Writes
  invalidate same-instance cache; other instances pick up changes within
  TTL.
- **CAS**: every write reads the latest SHA and passes it to the next
  `createOrUpdateFileContents` call. `updateVariables` retries up to 3
  times on a 409 SHA conflict, re-running the mutate against the freshly
  read doc — so concurrent writes to _different_ keys don't clobber each
  other.

## File reference

| File                                                                                                        | Purpose                                                                         |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`src/dashboard/lib/variables/get-variable.ts`](../src/dashboard/lib/variables/get-variable.ts)             | Runtime helper: `getVariable(name, { req })` with `process.env` fallback        |
| [`src/dashboard/lib/variables/store.ts`](../src/dashboard/lib/variables/store.ts)                           | GitHub Contents API read/write of `.kody/variables.json` + per-repo cache + CAS |
| [`src/dashboard/lib/variables/models.ts`](../src/dashboard/lib/variables/models.ts)                         | Typed accessor + Zod schema for the `LLM_MODELS` variable                       |
| [`app/api/kody/variables/route.ts`](../app/api/kody/variables/route.ts)                                     | `GET` (list with values) and `POST` (upsert)                                    |
| [`app/api/kody/variables/[name]/route.ts`](../app/api/kody/variables/%5Bname%5D/route.ts)                   | `DELETE`                                                                        |
| [`app/(chat-rail)/variables/page.tsx`](<../app/(chat-rail)/variables/page.tsx>)                             | The `/variables` page route                                                     |
| [`src/dashboard/lib/components/VariablesManager.tsx`](../src/dashboard/lib/components/VariablesManager.tsx) | The `/variables` page UI                                                        |

## FAQ

**Why aren't variables encrypted like secrets?**

Because they aren't secrets. Variables hold config you'd be fine seeing
in a PR diff (model ids, target URLs, feature flags), and keeping them
plaintext makes them readable and reviewable. Anything sensitive belongs
in the [Secrets vault](./secrets-vault.md).

**Why can I see the value but not a secret's value?**

The list endpoint returns variable values intentionally
(`listVariables` includes `value`). The secrets list returns names and
timestamps only. That difference is the whole point of having two stores.

**Can the same variables file be shared across connected repos?**

No. Each connected repo has its own `.kody/variables.json`. For shared
config, put it in `process.env` (the default fallback) or duplicate it
per repo.

**What does the QA flow read from variables?**

Two keys, both in the engine's preflight scripts:

- `QA_URL` — the QA agent's browse target. It's the last fallback in
  `resolveQaUrl`, after `--url`, a goal's latest Vercel deployment, and
  `$PREVIEW_URL`.
- `LOGIN_USER` — the test-account username. `loadQaContext` pairs it
  with the `LOGIN_PASSWORD` _secret_ (from the vault) to build the
  agent's auth instructions. Username is plaintext config; the password
  is encrypted.

**What happens during deploys?**

Reads pass through the cache; writes commit to GitHub. Neither depends on
Vercel deploy state. New deploys start with an empty in-memory cache and
warm up on the first request per repo.
