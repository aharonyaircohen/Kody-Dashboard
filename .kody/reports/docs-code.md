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

**No folder qualifies as under-documented** by the duty's own rule (≥ 4
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
post a phantom command — the engine has no handler, the operator's
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
