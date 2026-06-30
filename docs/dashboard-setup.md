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

| Store            | Page            | In the repo                  | Secret?               | Doc                                                       |
| ---------------- | --------------- | ---------------------------- | --------------------- | --------------------------------------------------------- |
| **Agents**       | `/agent`        | `.kody/agents/*.md`          | No (plaintext)        | [Agents & Capabilities](./concepts/staff-capabilities.md) |
| **Capabilities** | `/capabilities` | `.kody/capabilities/<slug>/` | No (plaintext)        | [Agents & Capabilities](./concepts/staff-capabilities.md) |
| **Commands**     | `/commands`     | `.kody/commands/*.md`        | No (plaintext)        | [Commands](./commands.md)                                 |
| **Secrets**      | `/secrets`      | `.kody/secrets.enc`          | **Yes** (AES-256-GCM) | [Secrets vault](./secrets-vault.md)                       |
| **Variables**    | `/variables`    | `.kody/variables.json`       | No (plaintext)        | [Variables](./variables.md)                               |
| **Context**      | `/context`      | `.kody/context/*.md`         | No (plaintext)        | [Context](./context.md)                                   |

Each store is per-repo: switch the connected repo and you're editing a
different set of files. All writes commit to the repo through the GitHub
Contents API, so changes show up in the repo history.

## What goes where

### Agents — `/agent`

Identity-only personas: an agent file says _who_ an agent is (role voice,
values, allowed commands, restrictions) and nothing about _what_ it does
or _when_ it runs. Capability contracts reference an agent member by slug; the engine
injects the agent ahead of the capability body at run time. Keep these pure
identity — no tasks, schedules, or implementation recipes. See
[Agents & Capabilities](./concepts/staff-capabilities.md).

### Capabilities — `/capabilities`

A capability folder describes the capability purpose, output, allowed commands,
and restrictions in `capability.md`; stores kind, agent, cadence, public action,
and implementation metadata in `profile.json`; and can be run manually or by the
engine scheduler. Toggle a capability off with `disabled: true`. Legacy
capability folders under `.kody/capabilities/` still load as
a fallback while repos migrate. See
[Agents & Capabilities](./concepts/staff-capabilities.md).

### Commands — `/commands`

Slash commands for the chat composer. Repo commands live at
`.kody/commands/<slug>.md` and merge with the shipped built-ins (`/plan`,
`/research`, `/review`, …); a repo command wins on slug collision. Bodies
support `$ARGUMENTS` / `$0` / `$1` substitution and work identically
across all chat backends. See [Commands](./commands.md).

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

### Context — `/context`

Free-form markdown context about your product/company at
`.kody/context/<slug>.md` — the kind of background you'd brief a new
teammate with. The dashboard injects the matching entries into chat and
agent context so answers are grounded in your domain. See
[Context](./context.md).

## End-to-end: set up QA

> **Pending.** Sourcing QA config from Variables + Vault + Context (in
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
3. **Context** (`/context`) — write the QA scenarios and key routes so
   the agent knows what to exercise and what "correct" looks like.
4. **Capabilities** (`/capabilities`) — enable the two QA capabilities by flipping
   `disabled: false`:
   - `qa` — the targeted QA pass.
   - `qa-sweep` — the broad, no-scope exploratory sweep.

That's the whole loop: targeting in Variables, the secret in the vault,
the playbook in Context, and the schedule in capability contracts. The engine reads
all four at tick time. Full walkthrough and the migration steps live in
[QA automation](./qa.md).
