---
name: publish-release
description: Create a release-request issue and dispatch the release executable on demand.
---

# Publish Release Skill

Use this skill when the `publish-release` executable runs from the matching duty.

## Job

On demand, cut a new release. Open a release-request issue titled `Release: <UTC date>` with who triggered it and why, then post `@kody release` on the issue.

The release executable reads `.kody/variables.json` `RELEASE_FLOW`:
- single-main repos open the version PR to `main`
- dev/main repos open the version PR to `dev`, then a promotion PR to `main`

It never tags before the version PR is merged.

This job is manual. Never run it from a tick.

## Allowed Commands

`@kody release`

## Restrictions

- Run only when explicitly triggered.
- Do not open a new release issue if today's release issue is already open or running.
- The bare `@kody` tag routes to classify/fix; always post explicit `@kody release`.
- Do not modify code, PR bodies, PR titles, or labels beyond creating the release-request issue and posting the trigger comment.
