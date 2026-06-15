# release-promote skill

Open the production promotion PR when the repo has separate integration and production branches.

## Owns
- Compare production branch against integration branch.
- Open a PR from integration to production after the GitHub Release exists.
- Label the PR `release`.
- Request configured release reviewers from `.kody/variables.json` or `CODEOWNERS`.

## Skip rule
Skip this skill when `integrationBranch` equals `productionBranch`.

## Does not own
- Merging the production PR.
- Bypassing branch protection.
- Force-pushing protected branches.
