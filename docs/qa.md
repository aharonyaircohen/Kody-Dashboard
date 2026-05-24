# QA automation

The dashboard ships a **QA engineer** that browses the running app like a
real user, decides PASS/CONCERNS/FAIL, and recommends an action — it never
fixes, merges, or approves. It is built from one **staff persona** plus two
**duties** (see [./concepts/staff-duties.md](./concepts/staff-duties.md) for
the staff/duty model), all driving a single engine executable
(`qa-engineer`) that does the actual Playwright browsing.

Everything ships **disabled** out of the box, because a real-browser pass is
expensive and the dashboard is PAT-gated — without credentials every run
just hits a login wall. Flip the duties on once you've done the one-time
[Setup](#setup) below.

## The pieces

| Piece                        | What it is                                                                                                                                                                          | Where                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `qa` **staff**               | Identity only — a senior quality advocate who trusts what it has _seen_ over what a diff claims, flags but never fixes, never rubber-stamps. No tasks, verbs, or cadence live here. | [`../.kody/staff/qa.md`](../.kody/staff/qa.md)               |
| `qa` **duty**                | Changelog verification (`every: 30m`, `disabled: true`).                                                                                                                            | [`../.kody/duties/qa.md`](../.kody/duties/qa.md)             |
| `qa-sweep` **duty**          | Broad exploratory smoke (`every: 1h`, ~once/day, `disabled: true`).                                                                                                                 | [`../.kody/duties/qa-sweep.md`](../.kody/duties/qa-sweep.md) |
| `qa-engineer` **executable** | The browser. Playwright MCP (headless Chromium), read-only on the repo, emits one structured report.                                                                                | engine: `src/executables/qa-engineer/`                       |

Neither duty browses anything itself. Each one opens a tracking issue and
posts `@kody qa-engineer …` onto it; the engine picks that up, runs the
browser pass, and comments the verdict back. The duty reads the verdict on a
later tick. **One run in flight at a time** — that bound is the cost guard.

## The `qa` duty — changelog verification

The **changelog _is_ the state.** Each `## [Unreleased]` bullet in
[`../CHANGELOG.md`](../CHANGELOG.md) (one per merged PR) carries a trailing
QA marker, appended after the `— @author` and joined with `·`:

| State    | Marker                               |
| -------- | ------------------------------------ |
| untested | _(none)_                             |
| running  | ` · 🔄 QA (#<tracking>)`             |
| verified | ` · ✅ QA <YYYY-MM-DD>`              |
| issues   | ` · ⚠️ QA <YYYY-MM-DD> (#<finding>)` |

Per tick (one mutation max) it either resolves the in-flight run — read the
tracking issue, swap `🔄` → `✅`/`⚠️`, close it, post **one** inbox
recommendation (`approve` on PASS, `fix` on CONCERNS/FAIL) — or, if nothing
is in flight, picks the oldest untested bullet, opens a tracking issue,
dispatches the pass, and marks the bullet `🔄`. A `🔄` older than 2h with no
report is treated as stuck: the marker is stripped back to untested so QA
never wedges. There is no separate ledger; the marker swap is what stops an
entry being re-processed. Full body: [`../.kody/duties/qa.md`](../.kody/duties/qa.md).

## The `qa-sweep` duty — broad exploratory pass

The most expensive run, so it self-throttles: a 24h cadence guard means
`every: 1h` only _wakes_ it; it actually sweeps roughly once a day. It
dispatches `qa-engineer` with **no `--scope`**, so the engine smoke-tests
every discovered route against the live deployment — catching regressions in
already-shipped features that the changelog duty (which only tests _new_
entries) never revisits. One inbox rec per sweep: `fix` if it opened
findings, `note` for a clean run. Full body:
[`../.kody/duties/qa-sweep.md`](../.kody/duties/qa-sweep.md).

## What `qa-engineer` does

A oneshot engine executable. Given a base URL (and optionally a `--scope`),
it navigates with Playwright MCP, builds a short test matrix, and exercises
each surface across happy path, empty state, loading, error, validation,
narrow viewport, keyboard nav, and destructive-action gating. Its final
message is the entire QA report — a `## Verdict: PASS | CONCERNS | FAIL`
header, findings with reproducible steps and severity (P0–P3), plus a
machine-readable JSON block the postflight turns into one labelled GitHub
issue per finding. It writes throwaway screenshots under
`.kody/qa-reports/` (gitignored) and never runs `git`/`gh` or edits tracked
source.

## Dispatch + state flow

```
┌──────────────┐  every 30m / 1h   ┌─────────────────────────────┐
│ qa duty      │──────────────────▶│ open tracking issue          │
│ qa-sweep duty│                   │ comment @kody qa-engineer …  │
└──────────────┘                   └──────────────┬───────────────┘
       ▲                                          │ engine picks up dispatch
       │ read verdict on a later tick             ▼
       │                          ┌─────────────────────────────────┐
       │                          │ qa-engineer (Playwright MCP)     │
       │                          │  preflight: resolveQaUrl,        │
       │                          │             loadQaContext, …     │
       │                          │  → browse → PASS/CONCERNS/FAIL   │
       │                          └──────────────┬──────────────────┘
       │                                         │ comment report + JSON
       │  swap marker 🔄→✅/⚠️ (qa)               ▼
       │  summarize (qa-sweep)    ┌─────────────────────────────────┐
       └──────────────────────────│ tracking issue (verdict here)   │
                                  └──────────────┬──────────────────┘
                                                 │ one @-mention rec
                                                 ▼
                                      ┌────────────────────┐
                                      │ dashboard inbox     │
                                      │ (operator confirms) │
                                      └────────────────────┘
```

The inbox rec **must** `@`-mention the operator on its first line — that
mention is the only thing that routes it into the dashboard inbox — and
carries a `<!-- kody-cmd: @kody … -->` line that the Approve button posts
verbatim. QA is advisory only: it never merges, approves, labels, or fixes.

## QA context model

> **Pending: engine publish + per-repo migration.** This is the _target_
> design, landed on the engine in commit `kody-engine 5024a0a`
> ("feat(qa): replace .kody/qa-guide.md with profile + variables + vault")
> but **not yet published** to npm. Until the engine is published and each
> repo migrated, `qa-engineer` runs against whatever engine version your
> `kody.yml` pins. Treat this section as how QA _will_ source its context,
> not necessarily what a current production run does.

The legacy committed `.kody/qa-guide.md` (and the `loadQaGuide` preflight)
are **removed**. In their place, a `loadQaContext` preflight assembles QA
context from the three dashboard-managed, per-repo stores — the same stores
the rest of the dashboard already uses — so QA setup happens entirely in the
UI, with no hand-edited committed guide:

| QA input          | Sourced from                                                                           | Store                                    |
| ----------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| Scenarios & notes | Company Profile — every `.kody/profile/*.md`, concatenated                             | [./profile.md](./profile.md)             |
| Login username    | `LOGIN_USER` variable in `.kody/variables.json`                                        | [./variables.md](./variables.md)         |
| Login password    | `LOGIN_PASSWORD` secret in the encrypted vault `.kody/secrets.enc`                     | [./secrets-vault.md](./secrets-vault.md) |
| Base URL          | `QA_URL` variable in `.kody/variables.json` (replaces the old `config.qa.fallbackUrl`) | [./variables.md](./variables.md)         |

Two preflights consume these:

- **`resolveQaUrl`** picks the base URL in priority order: explicit `--url`
  → `--goal`'s latest successful Vercel deployment → `$PREVIEW_URL` env →
  the `QA_URL` variable. It errors fast if none resolve (browsing a
  non-existent host only produces a useless "page unreachable" report).
- **`loadQaContext`** reads `LOGIN_USER` from Variables, `LOGIN_PASSWORD`
  from the Vault, and the profile markdown, then composes a ready-to-insert
  auth instruction. Every step is fail-soft and never throws: missing
  everything is a valid state (the agent then browses public routes only and
  notes auth-gated surfaces as gaps).

**`KODY_MASTER_KEY` must be present in the `qa-engineer` run env** to decrypt
`LOGIN_PASSWORD` from the vault. Without it (or if the secret is unset), QA
degrades gracefully to **login-only**: it knows the username but has no
password, so it flags auth-gated surfaces as gaps rather than failing. A
saved Playwright `storageState.json` passed via `--auth-profile` short-circuits
this entirely — the session starts pre-authenticated and credentials aren't
needed.

## Setup

> Requires the QA context model above — i.e. an engine build at or past
> `kody-engine 5024a0a`. Until that's published, the steps still apply but
> only take effect once the engine is upgraded.

1. **Base URL** — set the `QA_URL` variable to your live dashboard URL.
   See [./variables.md](./variables.md).
2. **Login username** — set the `LOGIN_USER` variable to the QA login.
   See [./variables.md](./variables.md).
3. **Login password** — store `LOGIN_PASSWORD` as a vault secret on the
   `/secrets` page. See [./secrets-vault.md](./secrets-vault.md). Make sure
   `KODY_MASTER_KEY` is available to the engine run so it can decrypt.
4. **Scenarios** — write QA scenarios and notes as Company Profile files
   (`.kody/profile/*.md`). See [./profile.md](./profile.md).
5. **Enable** — flip `disabled: false` in
   [`../.kody/duties/qa.md`](../.kody/duties/qa.md) and
   [`../.kody/duties/qa-sweep.md`](../.kody/duties/qa-sweep.md).

You can enable one duty without the other — the changelog duty alone gives
per-PR verification; add the sweep for periodic broad coverage.

## File reference

| File                                                         | Purpose                                              |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| [`../.kody/staff/qa.md`](../.kody/staff/qa.md)               | QA persona (identity only)                           |
| [`../.kody/duties/qa.md`](../.kody/duties/qa.md)             | Changelog-verification duty                          |
| [`../.kody/duties/qa-sweep.md`](../.kody/duties/qa-sweep.md) | Broad exploratory sweep duty                         |
| `src/executables/qa-engineer/profile.json` (engine)          | Executable manifest — inputs, tools, preflight chain |
| `src/executables/qa-engineer/prompt.md` (engine)             | The QA engineer's browsing prompt + report format    |
| `src/scripts/resolveQaUrl.ts` (engine)                       | Base-URL resolution preflight                        |
| `src/scripts/loadQaContext.ts` (engine)                      | Profile + Variables + Vault context preflight        |

## FAQ

**Why is everything `disabled: true`?**

A real-browser pass is expensive and the dashboard is PAT-gated, so an
un-configured run just hits a login wall and burns a browser session for
nothing. Enable only after [Setup](#setup) gives QA a URL and credentials.

**Where does the verdict live — issues or the changelog?**

Both, by role. The `qa-engineer` report lands as a comment on the tracking
issue (and one labelled issue per finding). The `qa` duty then copies the
_outcome_ into `CHANGELOG.md` as a `✅`/`⚠️` marker — that marker is the
authoritative state, and what stops an entry being re-tested.

**Can I run a one-off QA pass without enabling the duties?**

Yes — comment `@kody qa-engineer --url <URL> --scope "<feature>"` on any
issue. The duties are just schedulers around that same command.

**What happened to `.kody/qa-guide.md`?**

Removed in `kody-engine 5024a0a`. QA context now comes from the Company
Profile, Variables, and the Vault instead of a committed guide file — see
[QA context model](#qa-context-model). The two duty bodies still reference
the old `qa-guide.md` blocker in their `disabled` notes; that text predates
the new model and will be reconciled when the engine ships.

**Does QA ever change my code or merge PRs?**

No. The persona "flags, doesn't fix"; the duties are advisory only and act
solely through `gh` to post recommendations. Every action waits on operator
confirmation in the inbox.
