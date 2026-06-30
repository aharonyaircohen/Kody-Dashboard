# AI Agency

An **AI Agency** is your org's portable operating manual — the
repo-agnostic answer to _"why this agency exists, what goals are active,
when loops run, who works here, what capabilities exist, what context Kody
should know, what slash commands and custom implementations exist, and how
Kody should behave."_ You **export** it
from one repo as a single JSON file and **import** it into another to stand
up the same team instantly.

The line the bundle draws is deliberate: an AI Agency setup carries the
**operating manual** plus current managed goals, not low-level runtime
history. Agents, capabilities, Context,
commands, capability implementations, managed goals,
instructions, and a portable slice of engine
policy travel; memory, secrets, variables, the inbox, notifications,
generated runtime activity, and the default branch stay behind, because
those belong to the _repo_, not the _agency_ — and an agency may span
several repos.
See [`src/dashboard/lib/company/types.ts`](../src/dashboard/lib/company/types.ts)
for the exact include/exclude list, encoded as the `CompanyBundle` shape.

The broader ownership model is in
[`./concepts/company-model.md`](./concepts/company-model.md). Agents and
capabilities are the heart of the bundle; read
[`./concepts/staff-capabilities.md`](./concepts/staff-capabilities.md)
first if the agent/capability split is new to you.

## The pieces

| Piece                          | What travels                                                                                                                                                           | Source on export                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Agents**                     | Each agent's slug, title, body, `disabled`. Schedule is always `null`, and capability-only role fields are always `null` (agents do not run on their own).             | `.kody/agents/*.md` via `listStaffFiles()`                                                      |
| **Capabilities**               | Each capability's slug, title, body, action, kind, implementation link, cadence, `disabled`, data contracts, output `reviewer`, and the agent slug it runs as.         | `.kody/capabilities/<slug>/{profile.json,capability.md}` via `listCapabilityFiles()`            |
| **Context**                    | Curated `.kody/context/*.md` entries and their agent audience list.                                                                                                    | `.kody/context/*.md` via `listContextFiles()`                                                   |
| **Commands**                   | Repo-defined slash commands only — slug, description, argument hint, body. Built-ins ship with the dashboard, so they're never exported.                               | `.kody/commands/*.md` via `listRepoCommandFiles()` (filtered `source === "repo"`)               |
| **Capability implementations** | Each custom implementation as a folder map: `profile.json` + `prompt.md` + any `*.sh` shell scripts + any `skills/<name>/SKILL.md`.                                    | legacy `.kody/executables/<slug>/` storage via `listExecutableFiles()` / `readExecutableFile()` |
| **Managed goals**              | Each managed agency goal instance and its state file. Goal runtime history is still repo state, so do not treat goals as reusable Store templates here.                | `goals/instances/<id>/state.json` via `listManagedGoalFiles()`                                  |
| **Instructions**               | The single repo behavioral overlay (tone/length/formatting), or `null` if the repo has none.                                                                           | `.kody/instructions.md` via `readInstructionsFile()`                                            |
| **Config** (policy)            | A repo-agnostic slice of `kody.config.json`: quality commands, comment aliases, the `@kody` access gate, default capability actions, and per-capability model routing. | `kody.config.json` via `getEngineConfig()`                                                      |

What it **excludes**, by design: memory, the secrets vault, variables,
dashboard/runtime config, the inbox, notifications, generated runtime
activity, and the default branch (`git.defaultBranch`) — that last one is
repo-specific even though the rest of `kody.config.json` is partly
portable.

> **Naming note:** the bundle's command collection was historically called
> `prompts`. Older bundles still carry a `prompts:` array; the import
> schema reads it as a fallback so pre-rename bundles keep importing their
> slash commands ([`companyBundleSchema`](../src/dashboard/lib/company/types.ts)).

## The bundle

One JSON document, `kodyCompany: 1` as its format discriminator, plus
provenance (`exportedAt`, `exportedFrom: "owner/repo"`). Each entry stores
only what round-trips through the existing file helpers - slug,
metadata, body - and **drops repo-specific fields** (`sha`,
`html_url`, commit/tick timestamps) on export, re-deriving them on import.
The downloaded filename is `kody-ai-agency-<owner>-<repo>-<YYYY-MM-DD>.json`.

The schema (`companyBundleSchema`) is tolerant of missing collections
(they default to empty) but strict on the discriminator and every entry
shape, so a malformed or unrelated JSON file is rejected up front with
`invalid_bundle` rather than half-written into the repo.

## Export flow

```text
/company export
  -> buildCompanyBundle()
  -> read agents, capabilities, Context, commands, capability implementations,
     managed goals, instructions, and config
  -> drop repo-only metadata
  -> download one JSON file
```

The reads are independent, so `buildCompanyBundle()` fans them out with
`Promise.all`. Only repo-defined commands are kept; only set config fields
are emitted (an unconfigured repo exports `config: null` rather than a bag
of empties).

## Import flow

```text
/company import
  -> validate the bundle
  -> write agent
  -> write capabilities
  -> write Context
  -> write commands
  -> write capability implementations
  -> write managed goals
  -> write instructions
  -> write config last
```

Ordering is intentional: **agent before capabilities** (so a capability naming an
agent member lands after that agent exists — cosmetic; the engine
resolves at tick time regardless), Context before later artifacts that may
reference it, and **config last** because it may reference capability action
slugs the earlier steps just created.

### Collision handling — `skip` vs `overwrite`

Each entry whose slug already exists on the target is resolved by `mode`:

- **`skip`** (default, non-destructive) — leave the existing target
  untouched, count it as `skipped`.
- **`overwrite`** — replace it, count it as `updated`.

For the single **instructions** file and the **config** slice, the same
rule applies per field: `skip` mode only writes a config field the target
doesn't already have, so an import never clobbers a deliberately-set
value. Failures are caught **per entry** — one bad file doesn't abort the
whole import; it's tallied as `failed` with a human-readable note.

The import returns a structured `CompanyImportResult`: a
created/updated/skipped/failed tally for each collection, an outcome enum
for instructions (`created`/`updated`/`skipped`/`absent`) and config
(`applied`/`skipped`/`absent`), and a `notes[]` array of per-item
failures the UI renders inline.

## Auth model

Mirrors the agent/capabilities routes: a header PAT (`requireKodyAuth` +
`getRequestAuth`) is enough to **read** for export, but an **import**
commits files, so it additionally requires a verified actor
(`verifyActorLogin`) and a signed-in user octokit (`getUserOctokit`) —
the commits are authored as the logged-in user. No user token →
`no_user_token` 401.

## Operators & config (same page family, not the bundle)

The `/company` route also fronts two `kody.config.json` editors that are
**repo-scoped settings, not part of the export/import bundle**:

- **Operators** (`/api/kody/company/operators`) — the `github.operators`
  list of GitHub logins that recommendation capabilities @-mention so their
  comments route into the dashboard inbox. Agency-set explicitly, never
  auto-filled; an empty list means recommendations reach no inbox.
- **Config** (`/api/kody/company/config`) — the dashboard-editable
  `kody.config.json` fields without their own page: quality verification
  commands, comment aliases, the `@kody` access gate
  (`access.allowedAssociations`), and the default branch
  (`git.defaultBranch`). Per-capability model routing is edited on
  `/models`; default action routing is edited in config.

These overlap the **policy** slice the bundle carries — but the bundle
deliberately drops `git.defaultBranch` (repo-specific) and never touches
operators (a per-repo inbox-routing list, not agency doctrine).

## File reference

| File                                                                                                    | Purpose                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`src/dashboard/lib/company/types.ts`](../src/dashboard/lib/company/types.ts)                           | Bundle shape, version, include/exclude doctrine, Zod `companyBundleSchema` (with legacy `prompts` fallback) |
| [`src/dashboard/lib/company/export.ts`](../src/dashboard/lib/company/export.ts)                         | `buildCompanyBundle()` — fans out the reads, maps each to its repo-agnostic shape                           |
| [`src/dashboard/lib/company/import.ts`](../src/dashboard/lib/company/import.ts)                         | `applyCompanyBundle()` — ordered writes, per-entry skip/overwrite, structured tally                         |
| [`app/api/kody/company/route.ts`](../app/api/kody/company/route.ts)                                     | `GET` (export bundle), `POST` (import bundle)                                                               |
| [`app/api/kody/company/operators/route.ts`](../app/api/kody/company/operators/route.ts)                 | `GET`/`PUT` the `github.operators` list                                                                     |
| [`app/api/kody/company/config/route.ts`](../app/api/kody/company/config/route.ts)                       | `GET`/`PATCH` the dashboard-editable `kody.config.json` fields                                              |
| [`src/dashboard/lib/components/CompanyManager.tsx`](../src/dashboard/lib/components/CompanyManager.tsx) | The `/company` page UI — Export, Import, on-collision toggle, result tally                                  |
| [`app/(chat-rail)/company/page.tsx`](<../app/(chat-rail)/company/page.tsx>)                             | `/company` route entry point                                                                                |
| [`src/dashboard/lib/api.ts`](../src/dashboard/lib/api.ts)                                               | `companyApi` client (`export`, `import`, `operators`, `config`)                                             |

## FAQ

**What's in an AI Agency setup vs what stays behind?** In: agent, capabilities,
Context, repo-defined commands, custom capability implementations, managed goals,
instructions, and a portable config slice (quality commands, aliases,
access gate, default capability actions, per-capability model routing). Out:
memory, secrets, variables, inbox, notifications, dashboard runtime config,
generated runtime activity, and the default branch.

**Are built-in slash commands exported?** No. Only `source === "repo"`
commands travel — built-ins ship with the dashboard, so re-importing them
would be redundant. (A repo command that forks a built-in by slug _does_
export, because it lives in `.kody/commands/`.)

**Is the [Context](./context.md) included?** Yes. Context entries and their
agent audience list are part of the bundle.

**What does `skip` vs `overwrite` decide?** What happens when a slug or
file already exists on the target. `skip` (default) keeps the existing
one; `overwrite` replaces it. For config, `skip` only fills fields the
target hasn't set, so it never clobbers a deliberate value.

**Why does agent import before capabilities, and config last?** Agents first so
a capability's named agent already exists (cosmetic — the engine resolves at
tick time anyway). Context lands before the things that may reference it.
Config last because it may reference action slugs the capability step just
created.

**Can one bad entry fail the whole import?** No. Each entry is written in
its own try/catch and tallied as `failed` with a note; the rest still
land.

**Do I need to be signed in to import?** Yes — an import commits files
authored as you, so it requires a verified actor and a user GitHub token.
Export only needs the header PAT.

**Will an older bundle still import?** Yes. Missing collections default to
empty, and the legacy `prompts:` array is read as the commands fallback,
so pre-rename bundles still import their slash commands.
