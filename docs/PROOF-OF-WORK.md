# Proof of Work

Kody has been tested and used on private production repositories, where it has shipped real changes, fixed real failures, and produced real reports on a recurring schedule.

## Why the evidence on this page is anonymized

The repositories Kody runs against are private. We cannot link directly to issues, pull requests, commits, file paths, repo names, customers, or business logic — doing so would expose private source code and proprietary information.

What this page provides instead:

- A description of the capabilities that have been exercised end-to-end in production.
- Anonymized case studies that describe the shape of the work, not the work itself.
- Placeholders for sanitized screenshots and log excerpts where identifiers have been redacted.

Everything described below has been observed running on at least one private repository. None of it is hypothetical.

## Proven capabilities

- [x] Autonomous feature implementation from a natural-language task description, ending in an opened pull request.
- [x] CI failure triage: reading workflow logs, identifying the failing step, and pushing a fix to the same branch.
- [x] Test failure repair: failing unit/integration test → diagnosis → code fix → green run.
- [x] Scheduled "duties" that run on a cadence (hourly, daily, weekly) and produce committed reports.
- [x] Code review on opened pull requests, posting structured feedback as comments.
- [x] Multi-step workflows that chain executables (e.g. classify → implement → test → open PR) inside a single run.
- [x] Cross-repository coordination via the Director: a goal opened in one repo dispatching work into another.
- [x] Mention-driven inbox routing: `@kody`, `@<staff-slug>`, and operator mentions reach the right handler.
- [x] Web Push notifications to the operator's installed PWA when their attention is required.
- [x] Secrets vault: per-repo encrypted secrets read at runtime without leaking into logs or workflow YAML.

## Case studies (anonymized)

### Case study 1 — Autonomous feature implementation

**Input.** An operator opened an issue on a private repo: a short paragraph describing a missing capability in a user-facing feature, no code references, no file paths.

**What Kody did.**

1. Picked up the issue from its mention queue.
2. Ran a research pass over the repository to locate the relevant module and its tests.
3. Drafted an implementation plan as a comment on the issue.
4. Opened a pull request against the working branch containing: the new code path, updated types, and added unit tests.
5. Re-ran on review feedback and pushed two follow-up commits in the same PR.

**Outcome.** PR merged by the operator. No human-written code in the diff; human review only.

**Time from issue open → PR ready for review.** Under 15 minutes.

### Case study 2 — CI / test failure fix

**Trigger.** A scheduled CI run on the main branch failed. A GitHub `check_run` webhook arrived at the dashboard.

**What Kody did.**

1. Pulled the failing job's logs via the GitHub API.
2. Identified the failing test and the assertion that broke.
3. Located the source-of-truth file responsible for the regression (a recent refactor had changed a return shape).
4. Pushed a fix commit to the same branch and re-triggered the workflow.
5. Posted a short summary comment explaining the root cause.

**Outcome.** CI green on the next run. The fix was a three-line change; the triage was the expensive part, and Kody owned it end-to-end.

### Case study 3 — Scheduled duty / report generation

**Setup.** A `weekly-review` duty configured on the repo with `every: 7d` cadence, owned by a `tech-writer` staff persona.

**What Kody does on every tick.**

1. Reads the previous week's merged PRs, closed issues, and committed reports.
2. Summarizes activity, flags items that stalled, and lists open risks.
3. Writes the report as a markdown file to `.kody/reports/<slug>-<date>.md` on the state branch via the GitHub API.
4. The dashboard's Reports page surfaces the new file automatically; no additional plumbing.

**Outcome.** Multiple weeks of reports accumulated on a private repo with zero human intervention between ticks. The operator reviews the report; the report is the artifact.

## Evidence

Each artifact below documents one real Kody run. Identifiers (repo names, usernames, file paths, customer references, internal URLs) are redacted before publication. New artifacts are appended over time.

### Artifact 1 — Natural-language task → PR opened

Demonstrates: task description in an issue → repository research → implementation → pull request opened → human review. Run on this same open-source repo, so links are unredacted.

| Field                          | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                     | [aharonyaircohen/Kody-Dashboard](https://github.com/aharonyaircohen/Kody-Dashboard)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Task / issue                   | [#19 — Cache invalidation: listing cache wiped on every single-item write (duties/staff/commands)](https://github.com/aharonyaircohen/Kody-Dashboard/issues/19)                                                                                                                                                                                                                                                                                                                                          |
| Pull request                   | [#20 — fix: guard listing cache wipe behind else in manifest cache invalidators](https://github.com/aharonyaircohen/Kody-Dashboard/pull/20)                                                                                                                                                                                                                                                                                                                                                              |
| Date                           | 2026-05-29                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Trigger → PR opened            | ~16 min from `@kody` comment to PR ready for review                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| What Kody changed (target fix) | Added `else` guards in `invalidateDutiesCache`, `invalidateStaffCache`, `invalidateCommandsCache`, and `invalidateMemoryCache` so the listing-cache wipe only runs when no slug/id is passed. Renamed `invalidateStaffCache` listing prefix from `staff:` to `staffs:` to avoid colliding with the per-item prefix (matching the `duty/duties` and `prompt/prompts` pattern in the same file). Added 8 unit tests in `tests/unit/github-client-cache.spec.ts` covering the per-item vs listing branches. |
| Diff size                      | 47 files changed, +798 / −497 (the targeted fix is ~2 files; the rest are auto-generated docs/CHANGELOG updates, builder pkg-lock churn, and `.kody/tasks/19/*` run-state bookkeeping bundled into the same commit)                                                                                                                                                                                                                                                                                      |
| Followups filed by Kody        | Flagged `invalidateMemoryCache` key naming inconsistency (`memory-index:` vs `memories:`) for a separate audit — recorded in `.kody/tasks/19/followups.json`.                                                                                                                                                                                                                                                                                                                                            |
| CI status                      | CI Quality Checks ✅, Vitest unit+integration ✅, Production Smoke skipped, Vercel preview deploy ❌ failure (preview build, unrelated to the patched code)                                                                                                                                                                                                                                                                                                                                              |
| Merged                         | Yes — squash-merged to `main` on 2026-05-29 by the human reviewer; branch deleted; issue #19 auto-closed via `Closes #19`.                                                                                                                                                                                                                                                                                                                                                                               |
| Human role                     | Opened the issue (one paragraph + code reference). Posted one `@kody` comment to trigger the run. Reviewed the PR and squash-merged it. No human edits to the diff.                                                                                                                                                                                                                                                                                                                                      |
| Evidence                       | Issue thread: <https://github.com/aharonyaircohen/Kody-Dashboard/issues/19> · PR conversation: <https://github.com/aharonyaircohen/Kody-Dashboard/pull/20> · Engine run log: <https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/26661029900>                                                                                                                                                                                                                                                |
| Honest caveats                 | (1) PR is oversized for the bug — the runner's `pnpm format` rewrapped every recently-touched file in the repo, and `git add -A` swept all of that into the same commit. The targeted fix itself is only 2 files. (2) Vercel preview check failed; CI Quality Checks + Vitest passed, which was enough to merge. (3) The next artifact on this page is run after a clean prettier pass on main so a future Kody PR doesn't bundle the same noise.                                                        |

### Artifact 2 — Same shape as #1, run on a clean tree to verify the diff-noise theory

Demonstrates: the oversized-diff caveat from Artifact 1 was caused by `pnpm format` rewrapping a backlog of unformatted files, not by Kody itself. After running a single prettier sweep on `main` between artifacts, the same end-to-end flow produced a surgical diff.

| Field                  | Value                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository             | [aharonyaircohen/Kody-Dashboard](https://github.com/aharonyaircohen/Kody-Dashboard)                                                                                                                                                                                                                                                                                                                                          |
| Task / issue           | [#21 — appendUserTurn missing backoff on 409 retry — busy-wait loop on sha conflict](https://github.com/aharonyaircohen/Kody-Dashboard/issues/21)                                                                                                                                                                                                                                                                            |
| Pull request           | [#22 — fix: add jittered backoff to appendUserTurn 409 retry](https://github.com/aharonyaircohen/Kody-Dashboard/pull/22)                                                                                                                                                                                                                                                                                                     |
| Date                   | 2026-05-29                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Trigger → PR opened    | ~6 min from `@kody` retry comment to PR ready for review (vs. ~16 min on #20 — faster because the preflight no longer had to do a full repo format)                                                                                                                                                                                                                                                                          |
| What Kody changed      | Added `await sleep(100 * attempt + Math.floor(Math.random() * 100))` to the 409 retry branch of `appendUserTurn` in `src/dashboard/lib/interactive-session.ts`, mirroring the existing pattern in the sibling `writeSessionMeta` function. Added 4 unit tests in `tests/unit/interactive-session.spec.ts` using `vi.useFakeTimers()` to assert `setTimeout` is called with the expected jittered delay on the retry path.    |
| Diff size              | **2 files changed, +114 / −1** — only the targeted fix and its tests. No formatting noise, no bookkeeping bundled in.                                                                                                                                                                                                                                                                                                        |
| CI status              | CI Quality Checks ✅, Vitest unit+integration ✅, Production Smoke skipped, Vercel preview ❌ (same infra-side failure as #20 — unrelated to the patched code).                                                                                                                                                                                                                                                              |
| Merged                 | Yes — squash-merged to `main` on 2026-05-29 by the human reviewer; branch deleted; issue #21 auto-closed via `Closes #21`.                                                                                                                                                                                                                                                                                                   |
| Human role             | Opened the issue, posted one `@kody` comment to trigger, fixed an unrelated stale lint error on `main` that broke Kody's preflight, posted a second `@kody` retry comment, reviewed the PR, squash-merged. No edits to Kody's diff.                                                                                                                                                                                          |
| Evidence               | Issue thread: <https://github.com/aharonyaircohen/Kody-Dashboard/issues/21> · PR conversation: <https://github.com/aharonyaircohen/Kody-Dashboard/pull/22> · Engine run log: <https://github.com/aharonyaircohen/Kody-Dashboard/actions/runs/26664269712>                                                                                                                                                                    |
| What this demonstrates | (1) Kody's first attempt **correctly aborted** when the repo's lint/format preflight was broken, surfacing the failure as a comment with the actual stderr — operator-friendly failure mode, no silent bad PRs. (2) Once the environment was healthy, the same prompt produced a clean, reviewable, single-purpose PR. (3) The 47-file caveat from Artifact 1 was the toolchain, not the agent — diff size went from 47 → 2. |

If you are evaluating Kody and need to see unredacted evidence, reach out directly — we can walk through a live private repo in a screen-share.

## Public demo repository

A dedicated public demo repository, where every capability above can be reproduced end-to-end with full links to issues, PRs, runs, and reports, will be added in a follow-up. This page will link to it once published.
