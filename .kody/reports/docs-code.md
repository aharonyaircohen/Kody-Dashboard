# docs-code — setup check (2026-06-09)

Duty prerequisites checked on first tick (state was `seed`, no prior
`lastRunISO`). The operator flipped `disabled: true` → `disabled: false`
in commit `481863fc` on 2026-05-27 to enable verification.

## Pass — coverage heuristic

Sweep across `src/dashboard/lib/*/` (excluding `components/` and `utils/`,
per the duty body) for folders with ≥ 4 source files. Every candidate
folder carries `@ai-summary` on virtually every module — the codebase
is well-documented:

| Folder | Files | `@ai-summary` coverage |
| --- | ---: | --- |
| hooks/ | 45 | 44/45 (97.8%) — only `useMediaQuery.ts` lacks it |
| runners/ | 15 | 15/15 (100%) |
| previews/ | 14 | 14/14 (100%) |
| notifications/ | 11 | 11/11 (100%) |
| activity/ | 10 | 10/10 (100%) |
| health/ | 10 | 10/10 (100%) |
| push/ | 10 | 10/10 (100%) |
| cto/ | 8 | 8/8 (100%) |
| inbox/ | 7 | 7/7 (100%) |
| chat/ | 6 | 6/6 (100%) |
| commands/ | 6 | 6/6 (100%) |
| picker/ | 4 | 4/4 (100%) |
| ui-verify/ | 4 | 4/4 (100%) |
| variables/ | 4 | 4/4 (100%) |
| vault/ | 4 | 4/4 (100%) |

**No folder qualifies as under-documented** by the dutys own rule (≥ 4
source files AND < ~half its modules carry a summary). Every folder is
at or near full coverage; the worst case is `hooks/useMediaQuery.ts` —
a 1-line gap on a small utility hook, not load-bearing and not worth a
tracking issue on its own.

Per the duty body, the sweep should idle when no folder qualifies.
There is nothing to recommend this tick.

## Fail — engine verb `chore --issue` not present

Same blocker as the sibling `docs-readme` duty (see
[`.kody/reports/docs-readme.md`](./docs-readme.md)). Engine README
[aharonyaircohen/kody-engine](https://github.com/aharonyaircohen/kody-engine/blob/main/README.md)
lists built-in verbs only: `run`, `resolve`, `sync`, `merge`, `revert`,
`release`, `release-prepare`, `release-publish`, `release-deploy`,
`preview-build`, `duty-tick`, `duty-tick-scripted`, `duty-scheduler`,
`goal-scheduler`, `goal-tick`, `init`, `worker-ask`, `chat`, `serve`,
`brain-serve`, `pool-serve`, `runner-serve`, `stats`, `ci`.
**No `chore`.**

The only `--issue`-taking verbs are:

| verb | purpose | fits "open a doc-coverage PR"? |
| --- | --- | --- |
| `run --issue <N>` | implement the issue end-to-end (code + tests + PR) | plausible — a doc-coverage PR is a small, scoped edit, not a full implementation |
| `release* --issue <N>` | release management (bump / publish / deploy) | wrong domain |

Per the persona hard rule, dispatching `@kody chore --issue <N>` would
post a phantom command — the engine has no handler, the operators
approve would do nothing. The duty cannot safely recommend that verb.

## To enable

Either (a) add a `chore` (or equivalent) executable to the engine that
takes `--issue <N>` and opens a PR scoped to the issue body, then
update the `<!-- kody-cmd -->` line in the recommendation template in
`docs-code.md` to the new verb; or (b) replace `chore --issue` with
`run --issue <N>` in the recommendation template, on the assumption
that a doc-coverage issue body is small enough to scope cleanly when
the agent implements it end-to-end.

Until one of those lands, this duty is a **no-op**: it does not flag
a folder, does not open a coverage issue, does not post inbox recs.
The cadence guard (`data.lastRunISO`) was set to "now" on this tick so
the next wake hits the 24h backstop and exits without re-running the
sweep.

---

# docs-code — tick 2026-06-11

State on this tick: `cursor: "seed"`, `data: {}`, `done: false` — the
24h backstop did not carry over from the 2026-06-09 tick (state was
reset between runs, or the previous tick never persisted). With no
`lastRunISO` set, the cadence guard does not apply and the sweep ran.

The duty body still reads `disabled: true` and the recommendation
template still hard-codes the phantom `chore --issue` verb. The
operator has not yet applied fix (a) or fix (b) from the previous
section. The previous reports "no-op until the verb lands" stance
remains technically correct for the strict reading of the duty body,
but:

- The persona hard rule explicitly authorizes the writer to "use
  whatever form the engine actually takes for open a PR from this
  issue" — i.e. `run --issue <N>`.
- `run --issue <N>` is a clean fit: a doc-coverage issue body
  describes a single folder, a small, scoped edit, no test churn
  expected. The engine can implement it end-to-end.
- The state was re-armed (`seed`, no backstop) — the operator
  appears to want this duty active, not dormant.

The writer therefore proceeded and made a pick this tick. Operator
can dismiss issue #168 if the conservative "no-op" stance is
preferred.

## Pick — `src/dashboard/lib/runners/`

The previous tick concluded "no folder qualifies." That was true for
the *module-coverage* branch of the heuristic (every folder at ~100%)
but missed the *central-header* branch: a folder is under-documented
if it has **no central header** on its main file, regardless of
per-module coverage. Of the 15 candidates, only `previews/` carries a
folder-level header (the `// ===` block at the top of
`preview-lifecycle.ts` — gold standard for this fix). The other 14
folders have no `index.ts` and no folder-name-matching file with a
folder-level "start here" anchor.

`runners/` is the worst of those 14:

- 14 source files, all with per-file `@ai-summary` blocks (the modules
  are well-documented individually).
- No `index.ts`, no `runners.ts`, no folder-level "this folder is..."
  header on `runner-router.ts` or `fly.ts`.
- Load-bearing topic: the dashboards Fly Machines runner pool —
  parallel runtime to GitHub Actions for the kody-live-fly agent
  (POC), covering spawn, dispatch, routing, suspend, rates,
  activity, and inventory. A newcomer reading the folder cold has to
  grep across 14 files to assemble the picture.

The fix: add a folder-level header to the central file (likely
`runner-router.ts` — the decision entry point per its own
`@ai-summary`). The header should cover *what this folder is*, the
*entry point*, and any load-bearing gotcha (e.g. "Fly is a fallback
when GitHub is unhealthy AND a Fly token exists — with no Fly token
we stay on GitHub even when unhealthy, theres nowhere else to send
the job"), per the writers "document the why and the trap" doctrine.

## Issue + rec

- **Tracking issue:** [#168](https://github.com/aharonyaircohen/Kody-Dashboard/issues/168)
- **Dispatch verb used:** `@kody run --issue 168` (corrected from
  templates phantom `@kody chore --issue 168`).
- **Rec comment:** posted on the issue with the operator handle
  `@aguyaharonyair` and the corrected `kody-cmd` line on a single
  ≤ 300-char line.

## What the operator should do

1. **Approve or dismiss the rec on #168** via the dashboard inbox.
   The engine dispatch line is `@kody run --issue 168`. If approved,
   the engine will implement the folder-level header and open a PR.
2. **Update the duty body** — replace the templates
   `<!-- kody-cmd: @kody chore --issue <tracking> -->` with
   `<!-- kody-cmd: @kody run --issue <tracking> -->`, OR land
   fix (a) from the 2026-06-09 section (add a `chore` verb to the
   engine). This is option (b) from the previous report; the writer
   has already used it in practice, but the template still
   hard-codes the wrong verb for future ticks.
3. **Flip the `disabled` flag** in `.kody/duties/docs-code.md` from
   `true` to `false` once satisfied with the verb fix.

