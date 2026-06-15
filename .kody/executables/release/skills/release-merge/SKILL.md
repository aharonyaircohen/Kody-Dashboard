# release-merge skill

Verify the merged version PR.

## Owns
- Check whether the version PR is merged.
- Read the merge commit SHA.
- Verify the new version exists on the integration branch.
- Re-run the relevant post-merge checks when possible.

## Does not own
- Manually merging PRs unless the repository policy explicitly allows it.
- Tagging.
- Opening production promotion PRs.

If the version PR is still open, stop with a successful waiting status instead of guessing.
