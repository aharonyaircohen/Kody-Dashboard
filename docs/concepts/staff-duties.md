# Staff & Duties

The dashboard's autonomous-work model is two kinds of plain markdown
files in the connected repo:

- **Staff** — `.kody/staff/<slug>.md`. A **persona**: _who_ an actor is
  (character, values, doctrine). No work, no schedule, no commands.
  Edited on the `/staff` page.
- **Duties** — `.kody/duties/<slug>.md`. A **scheduled job**: the work to
  do, plus the cadence to do it on. A duty names one staff member to run
  as. Edited on the `/duties` page.

The engine's cron enumerates `.kody/duties/*.md` on a fixed interval and
**ticks** each due duty. At tick time the named staff persona is injected
_ahead of_ the duty body, so the persona colours how the duty's work is
carried out. **Staff are never scheduled on their own — a duty drives
them.**

Both kinds share one implementation. Internally they're the same "ticked
markdown file" mechanism (`createTickedFiles`), differing only by
directory, commit scope, and which cache to invalidate. The shared record
shape is `TickFile`.

## Why persona = identity only, duty = method

This split is load-bearing, not stylistic.

The persona is injected **ahead of every duty body**, on every tick of
every duty that names it. So anything concrete in the persona — a task, a
domain, a verb, an output format, a cadence — would silently apply to
_all_ of that staff member's duties and cap what any future duty can ask
for. A `cto.md` that said "review open PRs" would drag PR-review framing
into a `cto`-run security sweep.

Keeping the persona to identity/values only makes it composable: the same
`cto` can run a security audit, a changelog check, or a dependency sweep,
because each duty supplies its own method and the persona only supplies
the judgment and voice. See [`.kody/staff/cto.md`](../../.kody/staff/cto.md)
for the canonical "identity only" persona (note its explicit caveat that
all concrete responsibility lives in the duty that names it).

So:

|                               | Staff (persona)         | Duty (job)                        |
| ----------------------------- | ----------------------- | --------------------------------- |
| File                          | `.kody/staff/<slug>.md` | `.kody/duties/<slug>.md`          |
| Answers                       | _Who is acting?_        | _What work, how, how often?_      |
| Owns the schedule?            | No                      | **Yes** (`every:`)                |
| Owns the method?              | No (identity only)      | **Yes** (the body)                |
| Carries `staff:` frontmatter? | No                      | Yes — names the persona to run as |
| Independently scheduled?      | No                      | Yes — the cron ticks it           |

## Duty frontmatter

A duty is markdown with an optional flat-YAML frontmatter block. The
recognized keys match the kody2 main engine contract. See
[`.kody/duties/security-audit.md`](../../.kody/duties/security-audit.md)
for a full example.

```markdown
---
staff: kody
every: 1d
disabled: false
mentions: aguyaharonyair, alice
executables: research, plan
tools: Bash, Read
tickScript: |
  echo "preflight step"
---

# Security Audit

## Job

…the work the duty does, the cadence guard, allowed commands, state schema…
```

- **`staff:`** — slug of the persona under `.kody/staff/<slug>.md` to run
  as. A duty with **no `staff:` is skipped** by the scheduler; a `staff:`
  pointing at a missing file is a **hard error** at tick time (a duty must
  never run without the executor identity it declared).
- **`every:`** — cadence between auto-ticks. One of `15m`, `30m`, `1h`,
  `2h`, `6h`, `12h`, `1d`, `3d`, `7d`, or `manual`. Absent = tick on every
  cron wake (legacy default). `manual` = never auto-fires; only the
  dashboard "Run now" button executes it.
- **`disabled:`** — `true` makes the scheduler skip the duty on every cron
  wake. Only `disabled: true` is ever written; the enabled default leaves
  the line out so an unchanged file stays byte-identical. Manual "Run now"
  still fires a disabled duty — disabling blocks autonomous execution, not
  deliberate user action.
- **`mentions:`** — comma-separated GitHub logins the duty's output should
  `@`-mention (e.g. its recommendation comments). The engine injects them as
  the `{{mentions}}` prompt token, and that `@`-mention is what routes a
  duty's comment into the operator's dashboard inbox + push. Editable on the
  Duties page (with collaborator autocomplete) and shown read-only in the duty
  view. Replaces the old per-repo `github.operator` config. Absent = mentions
  no one.
- **`executables:`** — engine-side chain of executables this duty composes
  into a single tick (e.g. `research, plan`). A duty with an `executables:`
  chain does not run its own body — the engine composes each named
  executable's work into one run. The dashboard does NOT validate the names
  (engine built-ins may be valid). Absent = empty chain; the duty body
  runs as a single, un-composed tick.
- **`tools:`** — engine-side, **duty-only** tool allowlist. Distinct from
  the agent's runtime `claudeCode.tools`. The editor surfaces this as a
  separate "Duty tools" field so users don't conflate the two. Comma-
  separated, like `mentions:`. Absent = no duty-level allowlist; the
  engine uses the agent's defaults.
- **`tickScript:`** — optional inline shell script the engine runs as a
  preflight step before the tick. The dashboard accepts both a single-line
  value and a YAML block scalar (`|`) for multi-line scripts. Empty / null
  = no preflight script. The on-disk serializer emits multi-line scripts
  as a block scalar so round-trips stay readable.

Staff files carry no recognized frontmatter — they're identity only.
Folder duties (`.kody/duties/<slug>/profile.json`) carry the same
`staff` / `every` / `mentions` / `dutyTools` / `executable` knobs at the
top level of the profile. See
[`docs/executables.md`](../executables.md#folder-duty-top-level-fields) for
the on-disk shape.

## How a tick flows

```
                       engine cron (fixed interval)
                                  │
                                  ▼
              ┌───────────────────────────────────────┐
              │ job-scheduler  (no agent, skipAgent)   │
              │ dispatchJobFileTicks                   │
              │  • enumerate .kody/duties/*.md         │
              │  • per duty, read frontmatter once:    │
              │      - disabled? ──────────── skip     │
              │      - no staff? ──────────── skip     │
              │      - every: not due yet? ── skip     │
              └───────────────────┬───────────────────┘
                                  │ for each DUE duty
                                  ▼
              ┌───────────────────────────────────────┐
              │ duty-tick  (one duty, one agent run)   │
              │ loadJobFromFile preflight:             │
              │  • read .kody/duties/<slug>.md (body)  │
              │  • read staff: → .kody/staff/<staff>.md│
              │      persona injected AHEAD of body    │
              │  • if executables: chain is composed   │
              │  • if tickScript: preflight runs first │
              │  • load prior state (<slug>.state.json)│
              │ → agent decides + acts via gh          │
              │ → emits next-state block               │
              └───────────────────┬───────────────────┘
                                  │ postflight
                                  ▼
              ┌───────────────────────────────────────┐
              │ writeJobStateFile                      │
              │  commit .kody/duties/<slug>.state.json │
              │  (lastFiredAt, cursor, data.* …)       │
              └───────────────────────────────────────┘
```

Key points, grounded in the code:

- **The scheduler runs no agent.** `dispatchJobFileTicks` sets
  `ctx.skipAgent = true` and just fans out: enumerate `.kody/duties/*.md`,
  then `runExecutable("duty-tick", { duty: slug })` once per due duty,
  sequentially and in-process.
- **Three skip gates, in order:** `disabled: true` → skip; no/empty
  `staff:` → skip (loud, to stderr); `every:` cadence not yet elapsed →
  skip. A duty with no `every:` ticks on every wake; `manual` never
  auto-fires.
- **Cadence math uses `data.lastFiredAt`** from the duty's persisted
  state, not the file mtime. The scheduler compares `now - lastFiredAt`
  against `scheduleEveryToMs(every)`. A failed/missing state read falls
  through to "fire it" (better to double-tick once than drop a duty).
- **`loadJobFromFile` injects the persona ahead of the duty body.** It
  reads the duty's `staff:` slug, loads `.kody/staff/<staff>.md`, and sets
  `ctx.data.workerPersona` (the persona body) alongside `ctx.data.jobIntent`
  (the duty body). The persona is the executor identity; the duty is the
  method.
- **Each tick is at most one action.** Well-written duty bodies carry a
  **cadence guard** ("if last run within N hours, emit unchanged state and
  exit") and a one-action-per-tick rule (see `security-audit.md`). The
  duty itself usually cannot run shell beyond `gh`, so it delegates real
  work by posting `@kody`/`/kody` commands.

## State files

After a tick that acts, the engine commits a sibling
`.kody/duties/<slug>.state.json`. The dashboard reads it to render run
status:

- **`lastTickAt`** — last commit timestamp of `<slug>.state.json`. `null`
  = never run.
- **`nextEligibleAt`** — read from `data.nextEligibleISO` inside the state
  JSON. Each duty body is responsible for emitting this every tick (see the
  `## State` section of `security-audit.md`). `null` until it has run, or
  if the body doesn't emit the field. Surfaced as "next run".
- **`lastFiredAt`** — inside `data`; what the scheduler's cadence gate
  reads.

The dashboard only fetches commit history for a duty's state when a
sibling `.state.json` actually exists, to stay cheap under the shared
GitHub rate-limit budget.

## Editing & manual runs

- `/staff` (`GET`/`POST` [`app/api/kody/staff/route.ts`](../../app/api/kody/staff/route.ts))
  lists and creates personas. Staff creates take only `slug`, `title`,
  `body` — no schedule.
- `/duties` (`GET`/`POST` [`app/api/kody/duties/route.ts`](../../app/api/kody/duties/route.ts))
  lists and creates duties, accepting `staff`, `schedule` (one of the
  `every:` tokens), and `disabled`.
- Writes commit the `.md` file straight to the default branch via the
  signed-in user's token (a `GITHUB_TOKEN`-only request can read/list but
  cannot commit). Slugs must match `^[a-z0-9][a-z0-9_-]{0,63}$`.
- **"Run now"** triggers a manual dispatch by posting the comment
  `@kody duty-tick --duty <slug> --force` to the repo's "Kody control"
  issue. The engine's `issue_comment` trigger fires `kody.yml`; the
  dispatcher routes to the `duty-tick` executable with the named slug.
  It **bypasses the scheduler entirely** — so it ignores `disabled` and
  `every: manual` — but `duty-tick`'s loader still rejects a missing
  / dangling `staff:`. The `--force` flag tells the agent to ignore the
  duty body's own cadence guard for that run. The literal text is owned
  by [`buildDutyRunCommentBody`](../../src/dashboard/lib/duties/run-comment.ts)
  so the API route (`POST /api/kody/duties/<slug>/run`) and the chat
  `run_duty` tool can never drift apart.

## A note on cron cadence

Three cron numbers are in play, and they're consistent once you see how they
relate:

- **The wake** — `templates/kody.yml` triggers the engine on `*/15 * * * *`,
  i.e. **every 15 minutes**. This is the canonical cadence. (Its inline
  comment says "every 30 minutes" — that comment is stale; the cron is the
  truth.)
- **Per-executable eligibility** — on each wake, `runScheduledFanOut` fires
  every scheduled "watch" whose own `schedule` cron matches the wake window.
  `job-scheduler` declares `*/5 * * * *` — a _maximum_ eligible cadence, not a
  second clock. Every 15-minute wake is also a multiple of 5, so `*/5` matches
  every wake, and job-scheduler effectively runs once per wake (15 min). If the
  wake were ever made faster, that `*/5` would let it run as often as every 5
  minutes — that's what it reserves.
- **The dashboard mirror** — `CRON_INTERVAL_MS` (15m) in
  [`ticked/schedule.ts`](../../src/dashboard/lib/ticked/schedule.ts) mirrors the
  `*/15` wake purely to render "next tick" estimates.

So the effective cadence is **15 minutes**, gated further per duty by its
`every:` frontmatter. The only genuine inconsistency is the stale "30 minutes"
comment in `kody.yml`.

## File reference

| File                                                                                       | Purpose                                                                                                         |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [`src/dashboard/lib/staff-files.ts`](../../src/dashboard/lib/staff-files.ts)               | Staff preset over the shared store (`.kody/staff`, scope `staff`)                                               |
| [`src/dashboard/lib/duties-files.ts`](../../src/dashboard/lib/duties-files.ts)             | Duty preset over the shared store (`.kody/duties`, scope `duties`)                                              |
| [`src/dashboard/lib/ticked/files.ts`](../../src/dashboard/lib/ticked/files.ts)             | The one ticked-file store: `createTickedFiles`, `TickFile`, read/write/list/delete                              |
| [`src/dashboard/lib/ticked/frontmatter.ts`](../../src/dashboard/lib/ticked/frontmatter.ts) | Flat-YAML parser; `every:`/`staff:`/`disabled:`/`executables:`/`tools:`/`tickScript:`; cadence tokens + ms math |
| [`src/dashboard/lib/duties/run-comment.ts`](../../src/dashboard/lib/duties/run-comment.ts) | Builds the `@kody duty-tick --duty <slug> --force` comment body (single source of truth)                        |
| [`src/dashboard/lib/duties/merge-patch.ts`](../../src/dashboard/lib/duties/merge-patch.ts) | Read-merge for the duty PATCH route (omit preserves, explicit `[]`/`null` clears)                               |
| [`src/dashboard/lib/ticked/schedule.ts`](../../src/dashboard/lib/ticked/schedule.ts)       | "Next tick" math (`CRON_INTERVAL_MS`) + relative-time formatting                                                |
| [`app/api/kody/staff/route.ts`](../../app/api/kody/staff/route.ts)                         | `GET` list / `POST` create staff                                                                                |
| [`app/api/kody/duties/route.ts`](../../app/api/kody/duties/route.ts)                       | `GET` list / `POST` create duties                                                                               |
| [`app/api/kody/duties/[slug]/route.ts`](../../app/api/kody/duties/[slug]/route.ts)         | `GET` read / `PATCH` update (read-merge) / `DELETE` a single duty                                               |
| [`app/api/kody/duties/[slug]/run/route.ts`](../../app/api/kody/duties/[slug]/run/route.ts) | `POST` "Run now" — posts the `duty-tick --duty <slug> --force` comment                                          |
| [`.kody/staff/cto.md`](../../.kody/staff/cto.md)                                           | Example persona (identity only)                                                                                 |
| [`.kody/duties/security-audit.md`](../../.kody/duties/security-audit.md)                   | Example duty (frontmatter + cadence guard + state schema)                                                       |
| `kody2/src/scripts/dispatchJobFileTicks.ts` (engine)                                       | Scheduler fan-out: enumerate duties, skip gates, per-slug `duty-tick`                                           |
| `kody2/src/scripts/loadJobFromFile.ts` (engine)                                            | Tick preflight: load duty body + inject staff persona ahead of it                                               |
| `kody2/src/executables/job-scheduler/profile.json` (engine)                                | Scheduled, no-agent scheduler executable                                                                        |
| `kody2/src/executables/duty-tick/profile.json` (engine)                                    | One-shot per-duty tick executable (`--duty <slug>`, `--force`)                                                  |

## FAQ

**Can a staff persona include the work it should do?**

No — by design. The persona is injected ahead of _every_ duty that names
it, so concrete behavior would cap all of those duties. Put method in the
duty. The persona is identity and values only.

**What happens if a duty's `staff:` points at a deleted persona?**

It's a hard error at tick time (`loadJobFromFile` throws), and the
scheduler skips a duty with no `staff:` at all. A duty never runs without
the executor identity it declared.

**Why are staff and duties the same code?**

They're both "a markdown file the engine's duty-tick chain enumerates
and ticks." The only differences are directory, commit scope, and
cache, which `createTickedFiles` binds. Splitting them would duplicate
read/write/list logic with no behavioral payoff.

**Can a duty have no schedule?**

Yes. With no `every:` it ticks on every cron wake (the legacy default).
Use `every: manual` for "never auto-fire; Run now only," or a cadence
token to throttle.

**Does disabling a duty stop "Run now"?**

No. `disabled: true` only blocks autonomous cron execution. Manual "Run
now" bypasses the scheduler and still fires.

**Where does "next run" come from?**

From `data.nextEligibleISO` in the duty's `<slug>.state.json`, which the
duty body emits each tick — not computed by the dashboard. If a body
doesn't emit it, the field stays `null`.
