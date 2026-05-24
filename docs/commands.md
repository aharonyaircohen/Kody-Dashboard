# Commands (slash commands)

Slash commands let you reuse a saved prompt template by typing
`/<slug>` in the chat composer. The dashboard expands the template
client-side and sends the rendered text to whichever backend you are
talking to (in-process chat model, Brain, Engine) — the model never sees the slash
form, just normal text.

## How it works

1. Type `/` in the chat input. A menu shows every available prompt.
2. Pick one (↑↓ + Enter/Tab, or click). The input becomes `/<slug> `.
3. Type your arguments after the space and press Enter.
4. Before sending, the dashboard substitutes the arguments into the
   prompt body and ships the result.

If the prompt has no `$ARGUMENTS` placeholder and you type some, the
dashboard appends them as `ARGUMENTS: <your text>` to the end of the
prompt — same fallback Claude Code uses.

## Where commands live

Two layers, merged at runtime:

| Source    | Location                    | Editable here?         |
| --------- | --------------------------- | ---------------------- |
| Dashboard | bundled in code (built-ins) | "Fork" forks into repo |
| Your repo | `.kody/commands/<slug>.md`   | Yes — full CRUD        |

Repo commands win on slug collision, so dropping
`.kody/commands/review.md` in your repo overrides the built-in
`/review`. Use **Fork** on the Commands page to seed a same-slug repo
file from a built-in's current contents.

To hide every built-in for a repo, commit any empty file at
`.kody/commands/.disable-builtins`. Only your repo commands will show.

## File format

```markdown
---
description: Review a PR with focus on security
argument-hint: <pr-number>
---

Review PR $ARGUMENTS in this repo. Focus on auth, input validation,
and secret handling.
```

- `description` — one-line summary shown in the slash menu.
- `argument-hint` — placeholder rendered next to the slug (e.g.
  `<pr-number>`). Optional.
- Body — the prompt that gets sent to the model after substitution.

Slugs must match `^[a-z0-9][a-z0-9_-]{0,63}$` (lowercase letters,
digits, dashes, underscores — start with a letter or digit). The
filename is the slug; `.md` is required.

## Argument substitution

| Placeholder     | Meaning                                                 |
| --------------- | ------------------------------------------------------- |
| `$ARGUMENTS`    | Everything the user typed after `/<slug>` (raw string). |
| `$0`, `$1`, …   | Positional tokens, shell-style quoted.                  |
| `$ARGUMENTS[N]` | Same as `$N`, longer form.                              |

Positional tokens respect quotes: `"hello world"` becomes a single
token. Example:

```
/migrate-component SearchBar React Vue
```

Renders this body:

```
Migrate the $0 component from $1 to $2.
```

…into:

```
Migrate the SearchBar component from React to Vue.
```

## Built-in commands

| Slug        | What it does                                                     |
| ----------- | ---------------------------------------------------------------- |
| `/plan`     | Plan a change without writing code yet.                          |
| `/research` | Investigate a topic. 3–5 tool calls, summary only — no edits.    |
| `/review`   | Review your uncommitted changes.                                 |
| `/explain`  | Explain a topic in this codebase.                                |
| `/issue`    | Research → draft → create an issue, then offer to run with Kody. |
| `/goal`     | Draft a new goal (motivation + metric + milestone).              |
| `/analyze`  | Analyze whatever you're viewing (issue, PR, run).                |
| `/duty`     | Draft a `.kody/duties/<slug>.md` scheduled duty.                 |
| `/init`     | Install the Kody engine in the connected repo.                   |

Fork any of them to customize the wording for your repo.

### The research-plan flow

`/research`, `/plan`, and `/issue` all expect the agent to follow a
research-first pattern that the kody-live system prompt enforces as
a hard rule:

1. Investigate the codebase with 3–5 search/read tool calls before
   writing or drafting anything.
2. Cite concrete `path:line` references, not recalled paths.
3. For `/issue`: include a **Research notes** block (2–4 bullets) in
   `additionalContext` summarizing what was searched and found.

`/issue` extends this with the executor handoff: after the issue is
created, the agent asks whether to dispatch it with `kody_run_issue` —
and only fires if you confirm.

## Why this is dashboard-only

Slash commands in this dashboard are **client-side prompt expansion**.
The dashboard reads the `.md` file, substitutes `$ARGUMENTS`, and
sends the expanded text as a normal user message. This works
identically across all three chat backends because the model never
sees `/<slug>` — only the rendered prompt.

If you've seen Claude Code's slash commands with `` !`shell` ``
injection, that part is **not** supported here. Shell preprocessing
requires a host with a working tree and a shell to run on; the
dashboard server (Vercel) has neither. Stick to plain text +
`$ARGUMENTS` for portable prompts.

## Caveats

- Prompts are sent verbatim. The model decides how to act on them; a
  prompt that says "draft an issue" won't actually open one — you
  still have to follow up with "ok, open it" (or use a tool-enabled
  agent).
- The slash menu only opens while the cursor is in the slug portion
  (no space typed yet). After the space, it closes and the rest of
  the line is treated as arguments.
- Updates take effect immediately for the user who saved them. Other
  team members see them within ~60s (server-side cache TTL on the
  GitHub contents fetch).
