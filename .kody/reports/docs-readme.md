# docs-readme — recheck (2026-06-10)

Duty is `disabled: true` in the body; prerequisites re-verified on this tick.
The state from the 2026-06-09 setup check still holds — the engine verb
issue is unchanged.

## Pass — area→doc map

All 15 mapped docs exist at the repo root (`inbox.md`, `tasks.md`, `runners.md`,
`vibe-and-voice.md`, `activity.md`, `executables.md`, `company.md`, `context.md`,
`engine-config.md`, `messages-and-mentions.md`, `changelog.md`, `commands.md`,
`secrets-vault.md`, `notifications.md`, `webhooks.md`). The map is in sync
with the live `docs/` tree.

## Fail — engine verb `chore --issue` not present

Re-verified via `gh api repos/aharonyaircohen/kody-engine/contents/src/executables`
on 2026-06-10. Built-in executables are: `duty-scheduler`, `duty-tick`,
`duty-tick-scripted`, `fix`, `fix-ci`, `goal-scheduler`, `goal-tick`, `init`,
`job-live-verify`, `merge`, `plan-verify`, `preview-build`, `probe-skill`,
`qa-goal`, `release*`, `resolve`, `revert`, `run`, `sync`, `worker-ask`. **No
`chore`.**

The only `--issue`-taking verbs remain `run` and `release*`. `run` is too
heavy for a doc-update issue (it implements end-to-end: code + tests + PR);
`release*` is the wrong domain.

## To enable

Either add a `chore` (or equivalent) executable to the engine that takes
`--issue <N>` and opens a PR scoped to the issue body, then update the
recommendation template in `docs-readme.md` to the new verb; or accept
`run --issue <N>` in the recommendation template on the assumption a
doc-update issue body is small enough to scope cleanly when the agent
implements it end-to-end.

## Current behavior

Until one of those lands, this duty is a **no-op**: it does not scan merged
PRs, does not open drift issues, does not post inbox recs. The
anti-re-scan guard (`data.lastCheckedMergedAt`) is set to "now" on this
tick so a future enable won't retro-scan history.
