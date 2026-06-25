---
every: manual
staff: kody
disabled: true
---

# publish a release

## Job

On demand, cut a new release. Open a release-request issue titled `Release: <UTC date>` (body: who triggered it and the date), then post `@kody release` on that issue so the release orchestrator runs **prepare → merge PR → publish → deploy**.

This job is **manual** — it never fires on a tick. Trigger it from the Jobs page ("Run now") when you want to ship. It replaces the old dashboard-header "Publish a release" button, which did exactly this (create a `Release: <date>` issue, then comment `@kody release`).

## Allowed Commands

`@kody release`

## Restrictions

- Run only when explicitly triggered. Never self-schedule (`every: manual` enforces this; do not change it without intent).
- Do not open a new release issue if a `Release: <today>` issue is already open or its release task is still running — comment `release already in progress for <date>` and stop.
- The bare `@kody` tag routes to `classify`/`fix`; you MUST post the explicit `@kody release` so the release orchestrator picks it up.
- Do not modify code, PR bodies, PR titles, or labels beyond creating the release-request issue (label `release`) and posting the trigger comment.

## State shape

`data.lastRelease` is `{ date: string, issueNumber: number, triggeredAt: ISO }` for the most recent release this job kicked off — used only to guard against double-triggering on the same day.
