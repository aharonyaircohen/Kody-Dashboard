# Custom executables

A **custom executable** is a new `@kody <slug>` action you define from the
dashboard — its own prompt, model, tools, skills, and shell preflight — stored
as a folder in your repo. The dashboard never invents a new engine concept for
this: it writes a normal engine `profile.json` (the same shape the built-in
`feature` and `fix` executables use) into `.kody/executables/<slug>/`, and the
engine resolves that folder **before** its own built-ins. So "build me a
custom action" is really "commit a known-good profile to a folder the engine
already reads."

Everything is repo-stored and per-repo. There is no separate registry, no
database row — the folder _is_ the executable, and the latest commit on the
default branch is the source of truth. That's why three different surfaces
(the [/executables](#) page, chat tools, and the Company bundle) can all CRUD
the same executable without coordinating: they all read and write the same
files through the GitHub Git Data API.

## The pieces

| Piece                          | What it is                                                                                                                                                              | Where                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| The executable **folder**      | `.kody/executables/<slug>/` — `profile.json` + `prompt.md` + optional `*.sh` preflight scripts + optional `skills/<name>/SKILL.md`. The engine reads this path first.   | the connected repo                                                                                   |
| **File layer**                 | Reads/writes the whole folder atomically (one blob per file → one tree → one commit) via the Git Data API. Reads strip the managed prompt contract; writes re-append it. | [`../src/dashboard/lib/executables/files.ts`](../src/dashboard/lib/executables/files.ts)             |
| **Profile helpers**            | Pure form-fields ↔ `profile.json` translation, slug validation, and engine-mirroring profile validation. No I/O.                                                       | [`../src/dashboard/lib/executables/profile.ts`](../src/dashboard/lib/executables/profile.ts)         |
| The **/executables page**      | CRUD UI: list, create, edit, validate, run, delete, set-default, import a skill.                                                                                         | [`../src/dashboard/lib/components/ExecutablesManager.tsx`](../src/dashboard/lib/components/ExecutablesManager.tsx) |
| **Control API**                | `GET`/`POST` collection, `GET`/`PATCH`/`DELETE` one, plus `/default`, `/run`, and `/import-skill` sub-routes.                                                            | [`../app/api/kody/executables/`](../app/api/kody/executables/)                                       |
| **Chat tools**                 | In-process tools that let Kody build/manage executables by conversation — same file layer, same atomic commit.                                                          | [`../app/api/kody/chat/tools/executable-tools.ts`](../app/api/kody/chat/tools/executable-tools.ts)   |
| **Company bundle**             | Export/import flattens each folder into a portable path→content map, so executables travel with the rest of a company profile.                                          | [`../src/dashboard/lib/company/`](../src/dashboard/lib/company/)                                      |

## What a folder contains

Every executable is a folder, not a single file — which is why the file layer
commits it through the Git Data API (one tree, one commit) rather than the
single-file `createOrUpdateFileContents` the commands/duties helpers use.

| File                       | Purpose                                                                                                       | Generated from                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `profile.json`             | The engine manifest — role, inputs, `claudeCode` (model/tools/skills/permission), lifecycle, preflight chain. | the form fields (or a raw override you paste)   |
| `prompt.md`                | The user-authored prompt, with the managed **output-format contract** appended after a sentinel.              | the prompt field + the landing                  |
| `skills/<name>/SKILL.md`   | Each declared skill's body. Committed _into_ the folder — see [Skills](#skills).                              | the skills list                                 |
| `*.sh`                     | Optional shell scripts run as preflight steps (setup work) before the agent.                                  | the shell-scripts list                          |

On **read**, the file layer strips the managed contract from `prompt.md` so the
editor shows only your part; on **write** it re-appends the right contract for
the landing. The `claudeCode.skills` array and the preflight `shell` steps are
always re-synced to the actual files being written, so the engine never points
at a skill or script that isn't there.

## Landing: PR vs comment

Every executable picks **where its result lands**, and that single choice
drives the whole profile shape:

| Landing     | `profile.json` shape                                                                                          | What happens                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **PR**      | `lifecycle: "pr-branch"` (mirrors the built-in `feature`): context-load → composePrompt → agent → verify → commit → PR → comment. Gets the `block-git` hook and the verify tool. | The agent works a branch and opens a pull request. Final message must be `DONE` + `COMMIT_MSG` + `PR_SUMMARY`.     |
| **Comment** | No lifecycle. Preflight `loadIssueContext` → `composePrompt`; postflight `parseAgentResult` → `postAgentComment`. | The agent answers and the engine's generic **`postAgentComment`** posts that answer verbatim as an issue comment — no branch, no PR. Comment-landing is **live**. Final message is `DONE` + `PR_SUMMARY` (the answer). |

### The output-format contract (why it's appended, not in the system prompt)

The engine parses the agent's **final message** for `DONE` / `COMMIT_MSG` /
`PR_SUMMARY` / `FAILED` markers (`parseAgentResult`). Live testing showed the
agent only reliably emits those markers when the contract is the **last**
instruction it sees — a `systemPromptAppend`-only contract gets ignored. So the
file layer appends the contract to the end of `prompt.md` (after a managed
sentinel) and strips it on read. Without the markers, `parseAgentResult`
reports `markerMissing` → no commit and no comment. This is a deliberate
work-around baked into [`profile.ts`](../src/dashboard/lib/executables/profile.ts),
not an engine field.

## Set default — the bare-`@kody` action

"Set default" is the only thing that doesn't write the executable folder — it
writes two top-level fields in **`kody.config.json`**:

| Target  | Field written         | Engine reads it when…                            | Built-in fallback when cleared |
| ------- | --------------------- | ------------------------------------------------ | ------------------------------ |
| issue   | `defaultExecutable`   | a comment on an **issue** is bare `@kody` (no verb) | `classify`                     |
| PR      | `defaultPrExecutable` | a comment on a **PR** is bare `@kody` (no verb)     | `fix`                          |

`POST /api/kody/executables/<slug>/default` with `{ target, clear? }` calls
`writeDefaultExecutable`, which merges the field into `kody.config.json`
(never clobbering other keys) and commits. Clearing reverts to the engine's
built-in default. The collection `GET` returns the current defaults alongside
the list so the page can badge which executable is the issue/PR default.

## Skills

A skill is a `skills/<name>/SKILL.md` file **committed into the executable's
own folder**. This is load-bearing and easy to get wrong:

> **`npx skills add` does not work for this.** That CLI installs skills into
> agent directories (`.claude/skills/`) the engine does **not** read, and
> Vercel has no working tree to run it in anyway. Instead, the dashboard's
> **Import skill** button fetches the source's `SKILL.md` over the GitHub API
> and commits it into `skills/<name>/` where the engine reads it.

The import endpoint accepts the same source format the `skills` CLI uses —
`owner/repo`, `owner/repo/path/to/skill`, or a `github.com` URL — fetches that
folder's `SKILL.md`, and hands it back for the editor to add; the actual commit
happens on save through the normal folder write.

Skills are also inert unless the profile assembles them: `composeProfile` adds
a `buildSyntheticPlugin` preflight step whenever the skills list is non-empty
(the built-in `probe-skill` declares it the same way). The file layer keeps
`claudeCode.skills` in sync with the committed `skills/` folders automatically.

## CRUD + run flow

```
┌────────────────────────────────────────────────────────────┐
│  Surfaces (all hit the same file layer, same atomic commit)  │
│  • /executables page   • chat tools   • Company import       │
└───────────────┬──────────────────────────────────────────────┘
                │ create / update / delete
                ▼
   ┌──────────────────────────────────────────┐
   │ files.ts (Git Data API)                   │
   │  fields → composeProfile → profile.json   │
   │  prompt + appendContract → prompt.md      │
   │  skills/<name>/SKILL.md, *.sh             │
   │  → 1 tree → 1 commit on default branch    │
   └───────────────┬──────────────────────────┘
                   │  .kody/executables/<slug>/ committed
                   ▼
   ┌──────────────────────────────────────────┐
   │ Run: POST /run → comment "@kody <slug>"   │
   │ (or "Set default" → kody.config.json)     │
   └───────────────┬──────────────────────────┘
                   │ engine resolves <slug> against
                   │ .kody/executables/ FIRST, then built-ins
                   ▼
   ┌──────────────────────────────────────────┐
   │ engine runs the executable                │
   │  • PR landing  → branch + pull request    │
   │  • comment     → postAgentComment         │
   └──────────────────────────────────────────┘
```

**Run** never invents a dispatch mechanism: `POST /api/kody/executables/<slug>/run`
with `{ issue, args? }` simply posts `@kody <slug> <args>` as an issue comment
under the acting user's token — the exact path the chat tools and a human
typing in the issue both use — then invalidates that issue's cache.

## Writes need a signed-in user token

Listing and reading an executable run under the shared polling token (the
module-level GitHub context), but **every write — create, update, delete,
set-default, run — requires a signed-in GitHub user token** (`getUserOctokit`),
because the commit/comment must be attributed to a real actor. Each write also
verifies the claimed `actorLogin` and records an audit entry
(`executable.create` / `.update` / `.delete` / `.set_default` / `.run`).
The slug is validated everywhere (`^[a-z0-9][a-z0-9_-]{0,63}$`) and the
generated profile is validated against the engine's invariants before commit.

## Company bundle

Executables are part of a portable **company** export/import. Export reads every
folder into a `CompanyExecutableEntry` — a flat `path → content` map plus the
slug — and import re-commits each one through the same `writeExecutableFile`,
preserving the original prompt contract. The bundle also carries the
`defaultExecutable` / `defaultPrExecutable` / `agent.perExecutable` config so a
company's default-action and per-executable model routing travel with it. See
the company files in [`../src/dashboard/lib/company/`](../src/dashboard/lib/company/).

## File reference

| File                                                                                                              | Purpose                                                        |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [`../src/dashboard/lib/executables/files.ts`](../src/dashboard/lib/executables/files.ts)                          | Folder CRUD via the Git Data API (atomic multi-file commits)   |
| [`../src/dashboard/lib/executables/profile.ts`](../src/dashboard/lib/executables/profile.ts)                      | Form fields ↔ `profile.json`, slug + profile validation, contract |
| [`../src/dashboard/lib/executables/index.ts`](../src/dashboard/lib/executables/index.ts)                          | Public re-export surface                                       |
| [`../src/dashboard/lib/components/ExecutablesManager.tsx`](../src/dashboard/lib/components/ExecutablesManager.tsx) | The /executables CRUD UI                                       |
| [`../app/api/kody/executables/route.ts`](../app/api/kody/executables/route.ts)                                    | List (`GET`) + create (`POST`)                                 |
| [`../app/api/kody/executables/[slug]/route.ts`](../app/api/kody/executables/[slug]/route.ts)                      | Read (`GET`) / update (`PATCH`) / delete (`DELETE`) one        |
| [`../app/api/kody/executables/[slug]/default/route.ts`](../app/api/kody/executables/[slug]/default/route.ts)      | Set/clear the bare-`@kody` default executable                  |
| [`../app/api/kody/executables/[slug]/run/route.ts`](../app/api/kody/executables/[slug]/run/route.ts)              | Run by posting `@kody <slug>` on an issue                      |
| [`../app/api/kody/executables/import-skill/route.ts`](../app/api/kody/executables/import-skill/route.ts)          | Fetch a skill's `SKILL.md` from a GitHub source                |
| [`../app/api/kody/chat/tools/executable-tools.ts`](../app/api/kody/chat/tools/executable-tools.ts)                | Chat tools for conversational CRUD                             |
| `kody.config.json` (consumer repo)                                                                                | `defaultExecutable` / `defaultPrExecutable` (set-default writes here) |

## FAQ

**How does the engine find my custom executable instead of a built-in?**

The engine's executable registry checks `.kody/executables/` **before** its own
`src/executables/`, so a folder whose `profile.json` `name` matches `<slug>`
wins for `@kody <slug>`. Same lookup the dashboard relies on for every action.

**What's the difference between "PR" and "comment" landing?**

PR landing runs the full `pr-branch` lifecycle and opens a pull request;
comment landing skips the branch entirely and posts the agent's answer verbatim
via the engine's `postAgentComment` postflight. Pick comment for analysis/answer
executables, PR for ones that change code.

**Why doesn't `npx skills add` work?**

That CLI writes into `.claude/skills/`, which the engine doesn't read — and the
dashboard runs on Vercel with no working tree to run it in. Use the **Import
skill** button: it fetches the `SKILL.md` over the GitHub API and commits it
into the executable's own `skills/<name>/` folder, where the engine reads it.

**Can I edit the raw `profile.json` instead of using the form?**

Yes — the editor exposes the raw profile, and create/update accept a
`profileJsonOverride` that wins over the form fields. The override is still
run through `validateProfile` before commit.

**Why does deleting/creating an executable show up as a commit?**

Because the folder _is_ the executable — there's no database. Every CRUD op is a
single commit to the default branch (`feat(executables): add <slug>`,
`chore(executables): remove <slug>`, …), which is also why changes are
attributed to your signed-in user token, not the shared polling token.

**Do executables travel between repos?**

Yes — they're part of the Company export/import bundle, flattened to a
path→content map and re-committed on import, along with the default-executable
and per-executable model config.
