# release-promote skill

Stage 4 (final) of the four-stage release chain.

## What this stage owns

- Verifying the integration branch is ahead of the production branch.
- Opening the dev→main (or integration→production) promotion PR.
- Labeling the PR with `release`.
- Requesting reviews from release reviewers.

## What this stage does NOT own

- Merging the production PR.
- Editing an open promotion PR.
- Bypassing branch protection.

## Hand-off

There is no next stage. Output `PROMOTE_PR:`, `NEW_VERSION:`, `RELEASE_URL:`, `REVIEWERS:` as the final summary of the release.
