# Dashboard setup

The dashboard manages your per-repo data as **files committed to the
connected GitHub repo** (everything under `.kody/`), edited through
dashboard pages — never hand-edited loose in the repo. Most stores are
plaintext markdown or JSON; one (Secrets) is a single encrypted blob.

There is exactly **one** required server-side env var: `KODY_MASTER_KEY`,
which unlocks the encrypted vault. See
[Secrets vault → One-time setup](./secrets-vault.md#one-time-setup) for
how to generate and install it. Everything else on this page is edited
through the dashboard once you're logged in.

## Stores at a glance

| Store         | Page         | In the repo             | Secret?         | Doc                                     |
| ------------- | ------------ | ----------------------- | --------------- | --------------------------------------- |
| **Staff**     | `/staff`     | `.kody/staff/*.md`      | No (plaintext)  | [Staff & Duties](./concepts/staff-duties.md) |
| **Duties**    | `/duties`    | `.kody/duties/*.md`     | No (plaintext)  | [Staff & Duties](./concepts/staff-duties.md) |
| **Prompts**   | `/prompts`   | `.kody/prompts/*.md`    | No (plaintext)  | [Prompts](./prompts.md)                 |
| **Secrets**   | `/secrets`   | `.kody/secrets.enc`     | **Yes** (AES-256-GCM) | [Secrets vault](./secrets-vault.md)     |
| **Variables** | `/variables` | `.kody/variables.json`  | No (plaintext)  | [Variables](./variables.md)             |
| **Profile**   | `/profile`   | `.kody/profile/*.md`    | No (plaintext)  | [Company profile](./profile.md)         |

Each store is per-repo: switch the connected repo and you're editing a
different set of files. All writes commit to the repo through the GitHub
Contents API, so changes show up in the repo history.

## What goes where

### Staff — `/staff`

Identity-only personas: a staff file says *who* an agent is (intent,
values, allowed commands, restrictions) and nothing about *what* it does
on a schedule. Duties reference a staff member by slug; the engine
injects the persona ahead of the duty body at run time. Keep these pure
identity — no tasks or domains. See
[Staff & Duties](./concepts/staff-duties.md).

### Duties — `/duties`

Scheduled jobs: a duty file describes intent, system prompt, allowed
commands, and restrictions, names a `staff:` persona, and is ticked by
the engine every ~5 min. Toggle a duty off with `disabled: true`. See
[Staff & Duties](./concepts/staff-duties.md).

### Prompts — `/prompts`

Slash commands for the chat composer. Repo prompts live at
`.kody/prompts/<slug>.md` and merge with the shipped built-ins (`/plan`,
`/research`, `/review`, …); a repo prompt wins on slug collision. Bodies
support `$ARGUMENTS` / `$0` / `$1` substitution and work identically
across all chat backends. See [Prompts](./prompts.md).

### Secrets — `/secrets`

The encrypted vault: API keys, passwords, tokens — anything sensitive a
dashboard request reads at run time. Stored as one AES-256-GCM blob in
`.kody/secrets.enc`; values are never displayed after saving. This is
the **only** store that needs `KODY_MASTER_KEY`. See
[Secrets vault](./secrets-vault.md).

### Variables — `/variables`

The plaintext sibling of the vault: non-secret config you'd be fine
seeing in a PR diff — model lists, feature flags, target URLs,
usernames. Stored as readable JSON in `.kody/variables.json`. Put keys
and passwords in Secrets, not here. See [Variables](./variables.md).

### Profile — `/profile`

Free-form markdown context about your product/company at
`.kody/profile/<slug>.md` — the kind of background you'd brief a new
teammate with. The dashboard injects it into chat and agent context so
answers are grounded in your domain. See [Company profile](./profile.md).

## End-to-end: set up QA

> **Pending.** Sourcing QA config from Variables + Vault + Profile (in
> place of the old `.kody/qa-guide.md`) depends on an engine change
> (kody-engine commit `5024a0a`) being published **and** a per-repo
> migration. Until that lands for your repo, these steps are
> aspirational. See [QA automation](./qa.md) for status and detail.

Once the engine change is live, configuring QA is entirely
dashboard-managed — no env vars, no hand-edited files:

1. **Variables** (`/variables`) — set the QA targeting knobs:
   - `QA_URL` — the site the QA agent browses.
   - `LOGIN_USER` — the test-account username.
2. **Secrets** (`/secrets`) — set the one sensitive value:
   - `LOGIN_PASSWORD` — the test-account password (encrypted; never
     goes in Variables).
3. **Profile** (`/profile`) — write the QA scenarios and key routes so
   the agent knows what to exercise and what "correct" looks like.
4. **Duties** (`/duties`) — enable the two QA duties by flipping
   `disabled: false`:
   - `qa` — the targeted QA pass.
   - `qa-sweep` — the broad, no-scope exploratory sweep.

That's the whole loop: targeting in Variables, the secret in the vault,
the playbook in Profile, and the schedule in Duties. The engine reads
all four at tick time. Full walkthrough and the migration steps live in
[QA automation](./qa.md).
