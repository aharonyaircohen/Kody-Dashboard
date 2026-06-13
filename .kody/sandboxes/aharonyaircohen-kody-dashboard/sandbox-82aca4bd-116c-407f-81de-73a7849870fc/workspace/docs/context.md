# Context

**Context** is the curated background you write _for_ Kody — who the
company is, what it builds, its domain, customers, vocabulary, plus
persona briefs and any standing facts a staff member should always have
on hand. Each entry is a plain markdown file at
`.kody/context/<slug>.md` in the connected repo, edited from the
`/context` page, and **attached to one or more staff members** who then
inherit it without you restating it every turn.

The key distinction: Context is what you write _for_ Kody, **not** repo
documentation. Reference docs that already live in the repo (README,
DESIGN_SYSTEM.md, architecture notes) belong in the repo and stay there —
Context is the curated layer on top. "Reference a repo file from a
context entry" is a planned affordance but **not built yet**.

> **Supersedes [Company Profile](./profile.md).** Context is the renamed,
> generalized successor to the old Company Profile (landed on the engine
> in `0.4.136`). The `/profile` page, `/api/kody/profile` routes, and
> `ProfileManager` component have all been **removed**; `.kody/profile/`
> is gone too. The old company profile is now just one Context entry
> (typically slugged `company-profile`) attached to the `kody` staff.
> [`./profile.md`](./profile.md) is retained only as historical
> background — this doc is the live reference.

## The pieces

| Piece                      | What it is                                                                                                                                                | Where                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Context entry**          | One free-form markdown file. Slug = entry name (also the `###` heading Kody sees); body = the curated text. No built-ins.                                 | `.kody/context/<slug>.md`                                                               |
| **`staff:` frontmatter**   | A tiny one-line inline YAML list naming the staff-member slugs that **own** the entry. Decides which consumers load it.                                   | Frontmatter block atop each file (`staff: [kody, qa-engineer]`)                         |
| **Built-in audiences**     | `kody` (the in-process chat persona) and `qa-engineer` (the engine QA preflight). Always offered in the picker even without a `.kody/staff/*.md` file.    | [`context/frontmatter.ts`](../src/dashboard/lib/context/frontmatter.ts)                 |
| **`*` all-staff wildcard** | An entry owned by `*` is loaded by **every** consumer (chat, QA, and any future staff). Mutually exclusive with specific slugs — collapses to a lone `*`. | `ALL_STAFF` constant                                                                    |
| **Chat-prompt loader**     | Concatenates the `kody`-owned (or `*`) entries into the chat system prompt under a `## Context` heading. 60s in-process per-repo cache.                   | `loadContextForPrompt()` in [`context/files.ts`](../src/dashboard/lib/context/files.ts) |

There is **no schedule** and no built-in entries — Context is reference
material, not scheduled work. (Contrast staff/duties, which are scheduled
markdown; see [`./concepts/staff-duties.md`](./concepts/staff-duties.md).)

## The audience model — `staff:`

Each entry carries exactly one recognized frontmatter field, `staff:`,
written as an inline YAML list on one line because the engine parses it
with a simple inline-list reader (keep it `staff: [a, b]` — comma-
separated, square brackets). Three shapes:

| `staff:` value           | Meaning                                         | Who loads it                      |
| ------------------------ | ----------------------------------------------- | --------------------------------- |
| `[kody]` (default)       | Owned by the built-in chat persona.             | The in-process `kody` chat prompt |
| `[qa-engineer]`          | Owned by the QA reviewer persona.               | The engine's QA preflight only    |
| `[kody, qa-engineer, …]` | Owned by several specific staff members.        | Each named consumer               |
| `[*]` (all-staff)        | Owned by everyone, including staff added later. | Every consumer                    |
| `[]` (empty)             | **Unassigned** — owned by nobody.               | No consumer (parked/draft)        |

So an entry attached to `qa-engineer` only never reaches the chat prompt,
and an unassigned entry reaches no one — a valid "parked" state the UI
labels **Unassigned**.

### Legacy compatibility

Files written before the rename used an `audience:` list of consumers
(`chat` / `qa`) or had **no frontmatter at all**. Both are mapped on read
so existing data keeps flowing unchanged:

- `audience: chat` → `staff: [kody]`
- `audience: qa` → `staff: [qa-engineer]`
- **no frontmatter** → `staff: [kody]` (legacy = chat-only)

The mapping is read-only; the next write re-serializes the file with a
canonical `staff:` line.

## Chat injection

Only the **`kody`-owned** (and `*`) entries flow into chat. On every
kody-direct turn, `loadContextForPrompt()` lists the entries, keeps those
whose `staff` includes `kody` or `*`, joins them as `### <slug>\n\n<body>`
blocks, and the system-prompt builder drops the result under a
**`## Context — your default frame`** heading near the top of the prompt:

```
┌────────────────────────┐  per turn   ┌─────────────────────────┐  list + filter   ┌───────────────┐
│ /api/kody/chat/kody     │────────────▶│ loadContextForPrompt()  │─────────────────▶│ .kody/context │
└────────────────────────┘             └────────────┬────────────┘  (60s cache)      │   *.md files  │
                                                     │ keep staff ⊇ {kody, *}          └───────────────┘
                                                     │ "### <slug>\n\n<body>" joined
                                                     ▼
                                      ┌──────────────────────────────────────┐
                                      │ system prompt § "## Context"          │
                                      │  (framed as the agent's DEFAULT frame) │
                                      └──────────────────────────────────────┘
```

That heading is more than a label: it instructs the agent to treat the
block as its **primary frame** — a bare company/product/domain term is
answered about _that_, not the dictionary meaning, unless the user
explicitly contradicts it
([`system-prompt.ts`](../app/api/kody/chat/kody/system-prompt.ts)). The
load is best-effort — if it fails, chat continues without it.

**Scope:** only the in-process `kody` chat backend injects Context this
way. The `brain` and engine chat backends have their own system prompts.
The `qa-engineer`-owned entries are consumed by the **engine's** QA
preflight, not by anything in the dashboard runtime — see
[`./qa.md`](./qa.md), which sources its scenarios from Context.

## How it works

- **Storage:** one markdown file per entry under `.kody/context/`, read
  and written via the GitHub Contents API
  ([`context/files.ts`](../src/dashboard/lib/context/files.ts)). The
  `staff:` frontmatter is split off on read and re-attached on write;
  leading whitespace is trimmed and a trailing newline enforced.
- **Frontmatter:** a ~30-line flat-YAML parser/serializer
  ([`context/frontmatter.ts`](../src/dashboard/lib/context/frontmatter.ts))
  — no `gray-matter` dependency, same shape as the prompts/ticked
  frontmatter readers. Flat keys only; unknown keys silently dropped on
  read.
- **Cache:** `loadContextForPrompt()` caches per `owner/repo` for **60s**;
  every write/delete calls `invalidateContextPromptCache()` so edits show
  up immediately on the writing instance and within 60s on others.
- **Validation:** slug matches `^[a-z0-9][a-z0-9_-]{0,63}$`, immutable
  after creation; staff tokens match the same shape or `*`. Body is
  required (min length 1).

## Using it

Open `/context`.

### Add an entry

1. Click **New entry**.
2. Enter a **slug** — the entry name Kody sees (e.g. `company-profile`,
   `mission`, `products`). Lowercase letters, digits, dashes,
   underscores; must start with a letter or digit.
3. Pick **Staff** — defaults to `kody`. Choose specific members, "All
   staff" (`*`), or leave everything unchecked for **Unassigned**.
4. Write the **body** as plain markdown.
5. **Create entry.**

The dashboard commits `.kody/context/<slug>.md`
(`feat(context): add <slug>`).

### Edit an entry

Click the pencil. Body and staff are independent — re-attaching an entry
to a different staff member leaves the text intact, and vice versa. The
slug is fixed once created. Saving commits `chore(context): update <slug>`.

### Delete an entry

Click the trash icon and confirm. The file is removed with
`chore(context): remove <slug>`; the consumer stops seeing it on the next
load (immediately on the writing instance via cache invalidation).

Writes require a signed-in GitHub token (the commit is authored as you);
reads work with any dashboard auth.

## File reference

| File                                                                                                    | Purpose                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`src/dashboard/lib/context/files.ts`](../src/dashboard/lib/context/files.ts)                           | CRUD `.kody/context/<slug>.md` + `loadContextForPrompt()` (filters to `kody`/`*`, 60s cache)   |
| [`src/dashboard/lib/context/frontmatter.ts`](../src/dashboard/lib/context/frontmatter.ts)               | `staff:` frontmatter parse/serialize, legacy `audience:` mapping, `*` wildcard, built-in slugs |
| [`app/api/kody/context/route.ts`](../app/api/kody/context/route.ts)                                     | `GET` (list), `POST` (create)                                                                  |
| [`app/api/kody/context/[slug]/route.ts`](../app/api/kody/context/%5Bslug%5D/route.ts)                   | `GET` (read), `PATCH` (body and/or staff), `DELETE`                                            |
| [`src/dashboard/lib/components/ContextControl.tsx`](../src/dashboard/lib/components/ContextControl.tsx) | The `/context` page UI — list, view, create, edit, delete, staff multi-select + badges         |
| [`app/(chat-rail)/context/page.tsx`](<../app/(chat-rail)/context/page.tsx>)                             | `/context` route entry point                                                                   |
| [`app/api/kody/chat/kody/route.ts`](../app/api/kody/chat/kody/route.ts)                                 | Calls `loadContextForPrompt()` on each kody-direct turn                                        |
| [`app/api/kody/chat/kody/system-prompt.ts`](../app/api/kody/chat/kody/system-prompt.ts)                 | Builds the `## Context — your default frame` system-prompt section                             |
| [`src/dashboard/lib/api.ts`](../src/dashboard/lib/api.ts)                                               | `contextApi` client + `ContextEntry` type                                                      |

## FAQ

**What's the difference from the old Company Profile?** Context is the
generalized successor (engine `0.4.136`). The Profile was chat-only and
section-per-file; Context adds a `staff:` audience relation so entries can
target the chat persona, the QA reviewer, several staff, all staff, or
nobody. The old company profile is now one `kody`-owned entry. The
`/profile` page, API, and component are removed —
[`./profile.md`](./profile.md) is historical.

**Is Context the same as repo documentation?** No. Context is curated
text you write _for_ Kody. README/DESIGN_SYSTEM.md and other repo docs
stay in the repo. "Reference a repo file from a context entry" is planned
but **not built yet**.

**Which entries reach the chat prompt?** Only those owned by `kody` or the
`*` all-staff wildcard. An entry attached only to `qa-engineer` (or any
other non-`kody` staff) never reaches chat — it's consumed elsewhere
(the engine QA preflight).

**What does an empty `staff: []` mean?** Unassigned — owned by nobody,
loaded by no consumer. A valid "parked"/draft state.

**Can I attach an entry to a custom staff member?** Yes. The picker offers
the two built-ins (`kody`, `qa-engineer`) plus every `.kody/staff/*.md`
member in the repo. Only the built-in consumers (chat, QA preflight) load
context today; a custom staff slug owns the entry but nothing in the
dashboard runtime loads it yet.

**How fast do edits take effect?** The writing instance invalidates its
cache immediately; other Vercel instances pick up the change within the
60s TTL.

**Is Context part of the Company export/import bundle?** **No — not yet.**
The [Company](./company.md) bundle covers staff, duties, commands,
executables, instructions, and a config slice. Including Context is still
an open decision.

**Why not put this in instructions?** [Instructions](./profile.md)
(`.kody/instructions.md`) are a behavioral overlay (tone/length/
formatting), appended **last** in the prompt so they win on style. Context
is factual/persona background, injected **near the top** so it frames
everything. Keep facts and persona briefs in Context, behavioral rules in
instructions.

**Does deleting an entry erase history?** No — it removes the file with a
commit; the content stays in git history like any deleted file.
