# Company Profile

The Company Profile is a set of free-form markdown files stored in the
connected GitHub repo at `.kody/profile/<slug>.md`. You edit them from
the dashboard `/profile` page, and their concatenated bodies are
injected into the in-process chat system prompt so Kody knows who your
company is and what it does — without you restating it every turn.

Each file is plain markdown with **no frontmatter**. The filename
(without `.md`) is the slug, which doubles as the section heading Kody
sees (e.g. `mission`, `products`, `customers`, `tone`). The body is
factual context describing that slice of the company.

## What it is

- **Git-tracked, team-shared facts.** Files live in the repo, so the
  profile is versioned and shared with everyone on the team — not stored
  per-user or in a database.
- **Multi-file, like prompts.** One file per section; the UI lists them
  sorted by slug. Unlike prompts, there are no built-ins and no
  frontmatter.
- **Injected into chat context.** The concatenated bodies are fed to the
  `kody` (in-process) chat backend on every turn, under a
  `## Company profile` heading near the top of the system prompt.

## When to use

Use profile sections for **stable, factual background** about the
company/product that Kody should always have on hand: mission, what you
ship, who your customers are, your domain vocabulary, your tone.

It is **not** the place for:

- **Behavioral overrides** (how Kody should write/format/respond) —
  those go in repo **instructions** (`.kody/instructions.md`), which are
  appended LAST in the system prompt so they win on tone/length.
- **Secrets** — use the [secrets vault](secrets-vault.md).
- **Recurring work or personas** — use duties / staff.

## Using it

Open `/profile` (Company Profile in the dashboard).

### Add a section

1. Click **New section**.
2. Enter a **slug** (lowercase letters, digits, dashes, underscores;
   must start with a letter or digit; e.g. `mission`).
3. Write the **body** as plain markdown.
4. **Create**.

The dashboard commits `.kody/profile/<slug>.md` to the connected repo
(commit message `feat(profile): add <slug>`) and Kody picks it up on the
next chat turn.

### Edit a section

Click **Edit** on a row. The slug is fixed once created — only the body
is editable. Saving commits with `chore(profile): update <slug>`.

### Delete a section

Click **Delete** and confirm. The file is removed from the repo and Kody
stops seeing that section on the next chat turn.

Writes require a signed-in GitHub token (the commit is authored as the
logged-in user); reads work with any dashboard auth.

## How it works

```
┌──────────────────────────┐  CRUD   ┌──────────────────────────────┐
│ /profile page (browser)  │────────▶│ /api/kody/profile[/<slug>]   │
└──────────────────────────┘         │  GET/POST/PATCH/DELETE        │
                                      └───────────┬──────────────────┘
                                                  │ GitHub Contents API
                                                  ▼
                                      ┌──────────────────────────────┐
                                      │ .kody/profile/<slug>.md       │
                                      │ (committed to connected repo) │
                                      └──────────────────────────────┘

┌────────────────────────┐  per turn   ┌─────────────────────────┐  list+concat   ┌──────────────┐
│ /api/kody/chat/kody     │────────────▶│ loadProfileForPrompt()  │───────────────▶│ profile files│
└────────────────────────┘             └────────────┬────────────┘  (60s cache)    └──────────────┘
                                                     │ "### <slug>\n\n<body>" joined
                                                     ▼
                                      ┌──────────────────────────────────────┐
                                      │ system prompt § "## Company profile"  │
                                      └──────────────────────────────────────┘
```

- **Storage:** each section is one markdown file under `.kody/profile/`
  in the connected repo, read/written via the GitHub Contents API
  (`src/dashboard/lib/profile/files.ts`). Leading whitespace is trimmed
  and a trailing newline is enforced on write.
- **Loader:** `loadProfileForPrompt()` lists every file, joins them as
  `### <slug>\n\n<body>` blocks, and returns `null` when the repo has
  none. It caches per `owner/repo` for **60s**; write/delete routes call
  `invalidateProfilePromptCache()` so changes show up immediately on the
  writing instance.
- **Injection:** `/api/kody/chat/kody/route.ts` calls the loader and
  passes the result as `companyProfile` to the system-prompt builder
  (`system-prompt.ts`). It's added near the **top** of the prompt (after
  the connected-repo block), framed as authoritative background. The
  load is best-effort — if it fails, the chat continues without it.
- **Scope:** only the `kody` (in-process / default) chat backend injects
  the profile. The `brain` and engine backends have their own system
  prompts and do not receive it. Agent (non-chat) injection is planned
  but not yet wired (TBD).
- **Not in the Company bundle:** the profile is **not currently part of
  the Company export/import bundle** — that bundle exports only staff,
  duties, prompts, and instructions
  (`src/dashboard/lib/company/export.ts`). Including profile is an open
  decision.

## File reference

| File                                                                                                    | Purpose                                                                            |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`src/dashboard/lib/profile/files.ts`](../src/dashboard/lib/profile/files.ts)                           | Read/write/delete `.kody/profile/<slug>.md` + `loadProfileForPrompt()` (60s cache) |
| [`app/api/kody/profile/route.ts`](../app/api/kody/profile/route.ts)                                     | `GET` (list), `POST` (create)                                                      |
| [`app/api/kody/profile/[slug]/route.ts`](../app/api/kody/profile/%5Bslug%5D/route.ts)                   | `GET` (read), `PATCH` (update body), `DELETE`                                      |
| [`src/dashboard/lib/components/ProfileManager.tsx`](../src/dashboard/lib/components/ProfileManager.tsx) | The `/profile` page UI (list, create, edit, delete)                                |
| [`app/(chat-rail)/profile/page.tsx`](<../app/(chat-rail)/profile/page.tsx>)                             | `/profile` route entry point                                                       |
| [`app/api/kody/chat/kody/route.ts`](../app/api/kody/chat/kody/route.ts)                                 | Calls `loadProfileForPrompt()` and passes it as `companyProfile`                   |
| [`app/api/kody/chat/kody/system-prompt.ts`](../app/api/kody/chat/kody/system-prompt.ts)                 | Builds the `## Company profile` system-prompt section                              |

## FAQ

**What format are the files?** Plain markdown, no frontmatter. The slug
is the section name; the whole body is free-form context.

**Where do the slugs come from?** The filename without `.md`. Valid
slugs match `^[a-z0-9][a-z0-9_-]{0,63}$`. The slug is immutable after
creation — to rename, delete and recreate.

**Which chat sees the profile?** Only the default in-process `kody`
backend. The `brain` and engine backends use their own prompts and don't
receive it.

**How fast do edits take effect?** The writing instance invalidates its
cache immediately; other Vercel instances pick up the change within the
60s cache TTL.

**Is the profile included when I export my Company?** No — not currently.
The Company export/import bundle covers staff, duties, prompts, and
instructions only. Profile inclusion is still an open decision.

**Why not put this in instructions?** Instructions are a behavioral
override (tone/length/formatting), appended last so they win. The
profile is factual background, injected near the top so it frames
everything. Keep facts in the profile and rules in instructions.

**Does deleting a section delete history?** No. It removes the file with
a commit; the content remains in git history like any deleted file.
