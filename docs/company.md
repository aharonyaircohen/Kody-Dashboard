# Company

A **Company** is your org's portable operating manual — the
repo-agnostic answer to _"who works here, what recurring work runs, what
slash commands and custom executables exist, and how Kody should
behave."_ You **export** it from one repo as a single JSON file and
**import** it into another to stand up the same team instantly.

The line the bundle draws is deliberate: a Company carries the
**operating manual**, never the **operating state**. Staff, duties,
commands, custom executables, instructions, and a portable slice of
engine policy travel; memory, secrets, variables, goals, the inbox,
notifications, and the default branch stay behind, because those belong
to the _repo_, not the _company_ — and a company may span several repos.
See [`src/dashboard/lib/company/types.ts`](../src/dashboard/lib/company/types.ts)
for the exact include/exclude list, encoded as the `CompanyBundle` shape.

Staff and duties are the heart of the bundle; read
[`./concepts/staff-duties.md`](./concepts/staff-duties.md) first if the
persona/scheduled-work split is new to you.

## The pieces

| Piece               | What travels                                                                                                                                                | Source on export                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Staff**           | Each persona's slug, title, body, `disabled`. Schedule is always `null`, and duty-only role fields are always `null` (staff don't run on their own).        | `.kody/staff/*.md` via `listStaffFiles()`                                         |
| **Duties**          | Each duty's slug, title, body, action, executable link, cadence, `disabled`, data contracts, output `reviewer`, and the `runner` staff slug it runs as.     | `.kody/duties/<slug>/{profile.json,duty.md}` via `listDutyFiles()`                |
| **Commands**        | Repo-defined slash commands only — slug, description, argument hint, body. Built-ins ship with the dashboard, so they're never exported.                    | `.kody/commands/*.md` via `listRepoCommandFiles()` (filtered `source === "repo"`) |
| **Executables**     | Each custom executable as a folder map: `profile.json` + `prompt.md` + any `*.sh` shell scripts + any `skills/<name>/SKILL.md`.                             | `.kody/executables/<slug>/` via `listExecutableFiles()` / `readExecutableFile()`  |
| **Instructions**    | The single repo behavioral overlay (tone/length/formatting), or `null` if the repo has none.                                                                | `.kody/instructions.md` via `readInstructionsFile()`                              |
| **Config** (policy) | A repo-agnostic slice of `kody.config.json`: quality commands, comment aliases, the `@kody` access gate, default executables, per-executable model routing. | `kody.config.json` via `getEngineConfig()`                                        |

What it **excludes**, by design: memory, the secrets vault, variables,
dashboard/runtime config, goals, the inbox, notifications, and the
default branch (`git.defaultBranch`) — that last one is repo-specific
even though the rest of `kody.config.json` is partly portable. The
[Context](./context.md) feature (curated `.kody/context/*.md` entries) is
**also not in the bundle yet** — see its FAQ.

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
The downloaded filename is `kody-company-<owner>-<repo>-<YYYY-MM-DD>.json`.

The schema (`companyBundleSchema`) is tolerant of missing collections
(they default to empty) but strict on the discriminator and every entry
shape, so a malformed or unrelated JSON file is rejected up front with
`invalid_bundle` rather than half-written into the repo.

## Export flow

```
┌──────────────────────────┐  GET /api/kody/company  ┌──────────────────────────────┐
│ /company page (Export)   │────────────────────────▶│ buildCompanyBundle()          │
└──────────────────────────┘                         │  fan out 6 independent reads: │
            ▲                                         │  staff · duties · commands ·  │
            │ download JSON                           │  executables · instructions · │
            │                                         │  config                        │
            └─────────────────────────────────────────└──────────────┬───────────────┘
                                                                      │ map → repo-agnostic
                                                                      ▼
                                                       ┌──────────────────────────────┐
                                                       │ CompanyBundle (one JSON doc)   │
                                                       └──────────────────────────────┘
```

The six reads are independent, so `buildCompanyBundle()` fans them out
with `Promise.all`. Only repo-defined commands are kept; only set config
fields are emitted (an unconfigured repo exports `config: null` rather
than a bag of empties).

## Import flow

```
┌──────────────────────────┐  POST /api/kody/company   ┌──────────────────────────────┐
│ /company page (Import)   │─────────────────────────▶│ applyCompanyBundle(octokit,    │
│  choose .json + mode     │   { bundle, mode,          │                bundle, mode)   │
└──────────────────────────┘     actorLogin }           │  staff → duties → commands →   │
            ▲                                            │  executables → instructions →  │
            │ per-collection tally                       │  config (last)                 │
            └────────────────────────────────────────────└──────────────┬───────────────┘
                                                                         │ writeStaffFile / writeDutyFile /
                                                                         │ writeCommandFile / writeExecutableFile /
                                                                         ▼ writeInstructionsFile / writeConfigPatch
                                                          ┌──────────────────────────────┐
                                                          │ commits to the connected repo  │
                                                          └──────────────────────────────┘
```

Ordering is intentional: **staff before duties** (so a duty naming a
staff member lands after its executor exists — cosmetic; the engine
resolves at tick time regardless), and **config last** because it may
reference executables (the `default*Executable` slugs) the earlier steps
just created.

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

Mirrors the staff/duties routes: a header PAT (`requireKodyAuth` +
`getRequestAuth`) is enough to **read** for export, but an **import**
commits files, so it additionally requires a verified actor
(`verifyActorLogin`) and a signed-in user octokit (`getUserOctokit`) —
the commits are authored as the logged-in user. No user token →
`no_user_token` 401.

## Operators & config (same page family, not the bundle)

The `/company` route also fronts two `kody.config.json` editors that are
**repo-scoped settings, not part of the export/import bundle**:

- **Operators** (`/api/kody/company/operators`) — the `github.operators`
  list of GitHub logins that recommendation duties @-mention so their
  comments route into the dashboard inbox. Company-set explicitly, never
  auto-filled; an empty list means recommendations reach no inbox.
- **Config** (`/api/kody/company/config`) — the dashboard-editable
  `kody.config.json` fields without their own page: quality verification
  commands, comment aliases, the `@kody` access gate
  (`access.allowedAssociations`), and the default branch
  (`git.defaultBranch`). Per-executable model routing is edited on
  `/models`; the default PR executable on the executables route.

These overlap the **policy** slice the bundle carries — but the bundle
deliberately drops `git.defaultBranch` (repo-specific) and never touches
operators (a per-repo inbox-routing list, not company doctrine).

## File reference

| File                                                                                                    | Purpose                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`src/dashboard/lib/company/types.ts`](../src/dashboard/lib/company/types.ts)                           | Bundle shape, version, include/exclude doctrine, Zod `companyBundleSchema` (with legacy `prompts` fallback) |
| [`src/dashboard/lib/company/export.ts`](../src/dashboard/lib/company/export.ts)                         | `buildCompanyBundle()` — fans out the 6 reads, maps each to its repo-agnostic shape                         |
| [`src/dashboard/lib/company/import.ts`](../src/dashboard/lib/company/import.ts)                         | `applyCompanyBundle()` — ordered writes, per-entry skip/overwrite, structured tally                         |
| [`app/api/kody/company/route.ts`](../app/api/kody/company/route.ts)                                     | `GET` (export bundle), `POST` (import bundle)                                                               |
| [`app/api/kody/company/operators/route.ts`](../app/api/kody/company/operators/route.ts)                 | `GET`/`PUT` the `github.operators` list                                                                     |
| [`app/api/kody/company/config/route.ts`](../app/api/kody/company/config/route.ts)                       | `GET`/`PATCH` the dashboard-editable `kody.config.json` fields                                              |
| [`src/dashboard/lib/components/CompanyManager.tsx`](../src/dashboard/lib/components/CompanyManager.tsx) | The `/company` page UI — Export, Import, on-collision toggle, result tally                                  |
| [`app/(chat-rail)/company/page.tsx`](<../app/(chat-rail)/company/page.tsx>)                             | `/company` route entry point                                                                                |
| [`src/dashboard/lib/api.ts`](../src/dashboard/lib/api.ts)                                               | `companyApi` client (`export`, `import`, `operators`, `config`)                                             |

## FAQ

**What's in a Company vs what stays behind?** In: staff, duties,
repo-defined commands, custom executables, instructions, and a portable
config slice (quality commands, aliases, access gate, default
executables, per-executable model routing). Out: memory, secrets,
variables, goals, inbox, notifications, dashboard runtime config, and the
default branch.

**Are built-in slash commands exported?** No. Only `source === "repo"`
commands travel — built-ins ship with the dashboard, so re-importing them
would be redundant. (A repo command that forks a built-in by slug _does_
export, because it lives in `.kody/commands/`.)

**Is the [Context](./context.md) included?** Not yet. The curated
`.kody/context/*.md` entries (the renamed Company Profile) are
deliberately outside the bundle for now — including them is still an open
decision. See the context doc's FAQ.

**What does `skip` vs `overwrite` decide?** What happens when a slug or
file already exists on the target. `skip` (default) keeps the existing
one; `overwrite` replaces it. For config, `skip` only fills fields the
target hasn't set, so it never clobbers a deliberate value.

**Why does staff import before duties, and config last?** Staff first so
a duty's named executor already exists (cosmetic — the engine resolves at
tick time anyway). Config last because it may reference
`default*Executable` slugs the executable step just created.

**Can one bad entry fail the whole import?** No. Each entry is written in
its own try/catch and tallied as `failed` with a note; the rest still
land.

**Do I need to be signed in to import?** Yes — an import commits files
authored as you, so it requires a verified actor and a user GitHub token.
Export only needs the header PAT.

**Will an older bundle still import?** Yes. Missing collections default to
empty, and the legacy `prompts:` array is read as the commands fallback,
so pre-rename bundles still import their slash commands.

> **Doc-vs-code note:** the `CompanyManager` docstring and the page's
> static metadata still mention a one-time "legacy `.kody/jobs|workers` →
> `duties|staff` folder migration" card. The current component renders
> only Export and Import — there is **no migration card in the UI**. The
> docstring is stale; legacy folder migration is not surfaced on this
> page.
