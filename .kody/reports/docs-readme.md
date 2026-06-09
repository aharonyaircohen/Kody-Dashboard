# docs-readme — setup check (2026-06-09)

Duty is `disabled: true` in the body; prerequisites checked on first tick.

## Pass — area→doc map

All 15 mapped docs exist at the repo root (`inbox.md`, `tasks.md`, `runners.md`,
`vibe-and-voice.md`, `activity.md`, `executables.md`, `company.md`, `context.md`,
`engine-config.md`, `messages-and-mentions.md`, `changelog.md`, `commands.md`,
`secrets-vault.md`, `notifications.md`, `webhooks.md`). The map is in sync
with the live `docs/` tree.

## Fail — engine verb `chore --issue` not present

Engine README and `src/executables/` list built-in verbs only: `run`,
`resolve`, `sync`, `merge`, `revert`, `release`, `release-prepare`,
`release-publish`, `release-deploy`, `preview-build`, `duty-tick`,
`duty-scheduler`, `goal-tick`, `init`, `worker-ask`, `fix`, `fix-ci`, `merge`,
`plan-verify`, `qa-goal`, `probe-skill`, plus the `task-jobs*` test
fixtures. **No `chore`.**

The only `--issue`-taking verbs are:

| verb | purpose | fits "open a doc-update PR"? |
|---|---|---|
| `run --issue <N>` | implement the issue end-to-end (code + tests + PR) | too heavy — a doc update is a 1-file edit, not a full implementation |
| `release* --issue <N>` | release management (bump / publish / deploy) | wrong domain |

Per the persona hard rule, dispatching `@kody chore --issue <N>` would post a
phantom command — the engine has no handler, the operators approve would do
nothing. The duty cannot safely recommend that verb.

## To enable

Either (a) add a `chore` (or equivalent) executable to the engine that takes
`--issue <N>` and opens a PR scoped to the issue body, then update the
recommendation template in `docs-readme.md` to the new verb; or (b) replace
`chore --issue` with `run --issue <N>` in the recommendation template, on
the assumption that a doc-update issue body is small enough to scope cleanly
when the agent implements it end-to-end.

Until one of those lands, this duty is a **no-op**: it does not scan merged
PRs, does not open drift issues, does not post inbox recs. The
anti-re-scan guard (`data.lastCheckedMergedAt`) was set to "now" on this
tick so a future enable wont retro-scan history.
