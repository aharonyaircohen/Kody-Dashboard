# Custom executables

A **custom executable** is an implementation unit stored as a folder in your
repo: its own instructions, model, tools, skills, and shell preflight. Duties
own the public `@kody <action>` names; a duty can point at an executable with
`executable: <slug>`. The dashboard writes a normal engine `profile.json` (the
same shape the built-in `feature` and `fix` executables use) into
`.kody/executables/<slug>/`, and the engine resolves that folder **before** its
own built-ins.

Everything is repo-stored and per-repo. There is no separate registry, no
database row — the folder _is_ the executable, and the latest commit on the
default branch is the source of truth. That's why three different surfaces
(the [/executables](#) page, chat tools, and the Company bundle) can all CRUD
the same executable without coordinating: they all read and write the same
files through the GitHub Git Data API.

Kody chat can create or update one too: it should first read this guide, then
use the `create_or_update_executable` tool.

## The pieces

| Piece                     | What it is                                                                                                                                                                                                      | Where                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| The executable **folder** | `.kody/executables/<slug>/` — `profile.json` + `prompt.md` + optional `*.sh` preflight scripts + optional `skills/<name>/SKILL.md`. The engine reads this path first when a duty lowers to that implementation. | the connected repo                                                                                                 |
| **File layer**            | Reads/writes the whole folder atomically (one blob per file → one tree → one commit) via the Git Data API. For simple generated executables, reads strip the generated output contract and writes re-append it. | [`../src/dashboard/lib/executables/files.ts`](../src/dashboard/lib/executables/files.ts)                           |
| **Profile helpers**       | Pure form-fields ↔ `profile.json` translation, slug validation, and engine-mirroring profile validation. No I/O.                                                                                                | [`../src/dashboard/lib/executables/profile.ts`](../src/dashboard/lib/executables/profile.ts)                       |
| The **/executables page** | CRUD UI: list, create, edit, validate, delete, import a skill, and wire scripts/tools. It does not own public action names.                                                                                     | [`../src/dashboard/lib/components/ExecutablesManager.tsx`](../src/dashboard/lib/components/ExecutablesManager.tsx) |
| **Control API**           | `GET`/`POST` collection, `GET`/`PATCH`/`DELETE` one, plus `/import-skill` and `/analyze-tool` helpers.                                                                                                          | [`../app/api/kody/executables/`](../app/api/kody/executables/)                                                     |
| **Chat tools**            | In-process tools that let Kody build/manage executables by conversation — same file layer, same atomic commit.                                                                                                  | [`../app/api/kody/chat/tools/executable-tools.ts`](../app/api/kody/chat/tools/executable-tools.ts)                 |
| **Company bundle**        | Export/import flattens each folder into a portable path→content map, so executables travel with the rest of a company profile.                                                                                  | [`../src/dashboard/lib/company/`](../src/dashboard/lib/company/)                                                   |

## What a folder contains

Every executable is a folder, not a single file — which is why the file layer
commits it through the Git Data API (one tree, one commit) rather than the
single-file `createOrUpdateFileContents` the commands/duties helpers use.

| File                     | Purpose                                                                                                                                                                                   | Generated from                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `profile.json`           | The engine manifest — role, inputs, `claudeCode` (model/tools/skills/permission), lifecycle, preflight chain.                                                                             | the form fields (or a raw override you paste) |
| `prompt.md`              | Engine storage for user-authored instructions. It should be glue plus runtime context; reusable method goes in skills. Simple generated executables also get a generated output contract. | the instructions field + the landing          |
| `skills/<name>/SKILL.md` | Each declared skill's body. Committed _into_ the folder — see [Skills](#skills).                                                                                                          | the skills list                               |
| `*.sh`                   | Optional shell scripts run as preflight steps (setup work) before the agent.                                                                                                              | the shell-scripts list                        |

On **read**, the file layer strips the generated contract from `prompt.md` so
the editor shows only the instructions; on **write** it re-appends the right
default contract for the landing. The `claudeCode.skills` array and the
preflight `shell` steps are always re-synced to the actual files being written,
so the engine never points at a skill or script that isn't there.

Some executables are deterministic. They can run a preflight script/tool and
then use `skipAgent`; in that case `prompt.md` is only a small note, not a work
plan.

## How to create a proper executable

Start by deciding what kind of executable you are building:

| Kind                         | Use when                                                                          | Shape                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Agent executable**         | The work needs judgment, reading, editing, planning, or tool choice.              | `profile.json` wires an agent run; `prompt.md` gives short glue instructions; skills carry reusable method. |
| **Deterministic executable** | The work is mechanical and repeatable: parse files, call APIs, generate a report. | `profile.json` runs a shell preflight, then `skipAgent`; `prompt.md` is only a small note.                  |
| **Orchestrator executable**  | The work is routing or sequencing other executables.                              | `profile.json` uses postflight/preflight transitions; usually `skipAgent`.                                  |

Keep the executable folder easy for an operator to inspect:

```text
.kody/executables/<slug>/
  profile.json
  prompt.md
  run-or-setup.sh
  skills/
    <skill-name>/
      SKILL.md
```

Use these rules:

- `profile.json` is the wiring: name, inputs, model, allowed tools, skills, scripts, lifecycle, output action types.
- `prompt.md` is operator-owned instructions. Keep it small. It should say which skills/scripts/tools matter and how to finish.
- `skills/<name>/SKILL.md` is reusable method or domain knowledge. Put rules, rubrics, definitions, and repeatable reasoning there.
- `*.sh` files are deterministic executable-owned scripts. Put setup, parsing, API calls, report generation, and other mechanical work there.
- The **Tools** tab means MCP tool servers, not local helper scripts. Use it for things like Playwright MCP or codegraph MCP.
- Duties own public action names, cadence, staff assignment, purpose, and safety bounds. Do not put recurring-job policy in an executable.
- Staff files own persona. Do not redescribe staff identity in an executable.

Use `skipAgent` when the script does all the work:

```json
{
  "claudeCode": {
    "maxTurns": 0,
    "tools": [],
    "skills": ["company-graph"]
  },
  "scripts": {
    "preflight": [
      { "script": "buildSyntheticPlugin" },
      { "shell": "refresh-company-graph.sh" },
      { "script": "skipAgent" }
    ],
    "postflight": []
  }
}
```

In a `skipAgent` executable, the shell script must print the final result
itself:

```text
DONE
COMMIT_MSG: chore(reports): refresh company-graph
PR_SUMMARY:
- Refreshed .kody/reports/company-graph.md.
```

Use an agent when the executable needs judgment:

```text
# Instructions

Use the systematic-debugging skill.
Read the issue, reproduce the failure, make the smallest fix, and verify it.
```

Then the profile should allow only the tools that work needs, for example
`Read`, `Edit`, `Bash`, `Grep`, and `mcp__kody-verify`.

Avoid these mistakes:

- Do not put a long manual in `prompt.md`.
- Do not redescribe the staff member in `prompt.md`.
- Do not put deterministic code in prose instructions.
- Do not move executable-owned scripts to repo-global paths unless they are genuinely shared.
- Do not call a local shell script a "tool"; in this dashboard, tools are MCP servers.
- Do not add extra script runner types (`node`, `python`, etc.) unless the engine supports them. Use one `.sh` script and call what you need inside it.
- Do not leave engine metadata in operator-facing instructions when the executable does not need it.

`company-graph` is the reference deterministic executable:

```text
.kody/executables/company-graph/
  profile.json
  prompt.md
  refresh-company-graph.sh
  skills/company-graph/SKILL.md
```

The profile wires the run. The shell script refreshes the report. The skill
documents what the graph means. The instructions stay tiny.

## Landing: PR vs comment

Every executable picks **where its result lands**, and that single choice
drives the whole profile shape:

| Landing     | `profile.json` shape                                                                                                                                                             | What happens                                                                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PR**      | `lifecycle: "pr-branch"` (mirrors the built-in `feature`): context-load → composePrompt → agent → verify → commit → PR → comment. Gets the `block-git` hook and the verify tool. | The agent works a branch and opens a pull request. Final message must be `DONE` + `COMMIT_MSG` + `PR_SUMMARY`.                                                                                                         |
| **Comment** | No lifecycle. Preflight `loadIssueContext` → `composePrompt`; postflight `parseAgentResult` → `postAgentComment`.                                                                | The agent answers and the engine's generic **`postAgentComment`** posts that answer verbatim as an issue comment — no branch, no PR. Comment-landing is **live**. Final message is `DONE` + `PR_SUMMARY` (the answer). |

### The output-format contract

The engine parses the agent's **final message** for `DONE` / `COMMIT_MSG` /
`PR_SUMMARY` / `FAILED` markers (`parseAgentResult`). Live testing showed the
agent only reliably emits those markers when the contract is the **last**
instruction it sees — a `systemPromptAppend`-only contract gets ignored. So the
generic dashboard writer appends the contract to the end of `prompt.md` for
agent executables and strips it on read. Without the markers,
`parseAgentResult` reports `markerMissing` → no commit and no comment.

No-agent executables that use `skipAgent` do not need that marker or contract in
`prompt.md`, because no agent reads the file. Their script prints the final
`DONE` / `FAILED` block itself.

Existing engine executables that have custom postflight parsers are another
exception. Examples: `fix` requires `FEEDBACK_ACTIONS`, `research` requires
`PRIOR_ART`, `reproduce` requires `TEST_PATH` and `FAILURE_SIGNATURE`, and
review/QA executables post raw markdown instead of `DONE` blocks. For these,
the executable-owned contract must be the final instruction in `prompt.md`; do
not append the generic generated contract after it.

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

## CRUD + duty flow

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
   │  instructions + contract → prompt.md       │
   │  skills/<name>/SKILL.md, *.sh             │
   │  → 1 tree → 1 commit on default branch    │
   └───────────────┬──────────────────────────┘
                   │  .kody/executables/<slug>/ committed
                   ▼
   ┌──────────────────────────────────────────┐
   │ Duty action dispatches workflow          │
   │ action → duty → executable implementation │
   └───────────────┬──────────────────────────┘
                   │ engine resolves executable slug against
                   │ .kody/executables/ FIRST, then built-ins
                   ▼
   ┌──────────────────────────────────────────┐
   │ engine runs the executable                │
   │  • PR landing  → branch + pull request    │
   │  • comment     → postAgentComment         │
   └──────────────────────────────────────────┘
```

Execution assignment is owned by **Duties** — a duty binds public action, intent,
staff, cadence, and the implementation executable it may run. The
`/executables` page is edit-only; run dispatch lives on the duty.

## Writes need a signed-in user token

Listing and reading an executable run under the shared polling token (the
module-level GitHub context), but **every write — create, update, delete —
requires a signed-in GitHub user token** (`getUserOctokit`),
because the commit/comment must be attributed to a real actor. Each write also
verifies the claimed `actorLogin` and records an audit entry
(`executable.create` / `.update` / `.delete`).
The slug is validated everywhere (`^[a-z0-9][a-z0-9_-]{0,63}$`) and the
generated profile is validated against the engine's invariants before commit.

## Company bundle

Executables are part of a portable **company** export/import. Export reads every
folder into a `CompanyExecutableEntry` — a flat `path → content` map plus the
slug — and import re-commits each one through the same `writeExecutableFile`,
preserving the original prompt contract. The bundle also carries the
`agent.perExecutable` config so per-executable model routing travels with it. See
the company files in [`../src/dashboard/lib/company/`](../src/dashboard/lib/company/).

## File reference

| File                                                                                                               | Purpose                                                               |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| [`../src/dashboard/lib/executables/files.ts`](../src/dashboard/lib/executables/files.ts)                           | Folder CRUD via the Git Data API (atomic multi-file commits)          |
| [`../src/dashboard/lib/executables/profile.ts`](../src/dashboard/lib/executables/profile.ts)                       | Form fields ↔ `profile.json`, slug + profile validation, contract     |
| [`../src/dashboard/lib/executables/index.ts`](../src/dashboard/lib/executables/index.ts)                           | Public re-export surface                                              |
| [`../src/dashboard/lib/components/ExecutablesManager.tsx`](../src/dashboard/lib/components/ExecutablesManager.tsx) | The /executables CRUD UI                                              |
| [`../app/api/kody/executables/route.ts`](../app/api/kody/executables/route.ts)                                     | List (`GET`) + create (`POST`)                                        |
| [`../app/api/kody/executables/[slug]/route.ts`](../app/api/kody/executables/[slug]/route.ts)                       | Read (`GET`) / update (`PATCH`) / delete (`DELETE`) one               |
| [`../app/api/kody/executables/import-skill/route.ts`](../app/api/kody/executables/import-skill/route.ts)           | Fetch a skill's `SKILL.md` from a GitHub source                       |
| [`../app/api/kody/chat/tools/executable-tools.ts`](../app/api/kody/chat/tools/executable-tools.ts)                 | Chat tools for conversational CRUD                                    |

## FAQ

**How does the engine find my custom executable instead of a built-in?**

The engine's executable registry checks `.kody/executables/` **before** its own
`src/executables/`, so a folder whose `profile.json` `name` matches the
implementation slug wins when a duty lowers to that executable.

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
path→content map and re-committed on import, along with per-executable model
config.
