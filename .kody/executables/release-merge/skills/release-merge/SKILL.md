# release-merge skill

Stage 2 of the four-stage release chain.

## What this stage owns

- Waiting for the `release-prepare` PR to be merged.
- Running tests on the merge commit.
- Merging the release branch into the integration branch (dev, by default) as a squash commit.
- Verifying the new version is on the integration branch.

## What this stage does NOT own

- Tagging a release.
- Opening a dev→main PR.
- Force-pushing to any branch.

## Hand-off

The `release-tag` stage reads the merged SHA and the new version from your `PR_SUMMARY`. Output `MERGED_SHA:` on line 1, `NEW_VERSION:` on line 2, `INTEGRATION_BRANCH:` on line 3.
