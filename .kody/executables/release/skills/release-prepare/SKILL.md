# release-prepare skill

Prepare the version change.

## Owns
- Read current version from `package.json` or the closest project manifest.
- Apply the requested bump (`patch` by default).
- Update `CHANGELOG.md` with a dated release entry.
- Run the project test suite and linter.
- Create or reuse a release branch named `release/v<version>`.
- Open a version PR titled `chore(release): v<version>`.
- Put `Tracking-Issue: #<release issue number>` in the version PR body.
- After opening the PR, persist `<!-- kody-release-pr: #<PR number> -->` in the release issue body if it is not already present.

## Branch rule
The version PR target is the integration branch from `RELEASE_FLOW`.

- Single-main repo: integration is `main`, so the version PR targets `main`.
- Dev-to-main repo: integration is `dev`, so the version PR targets `dev`.

## Does not own
- Merging the version PR.
- Tagging.
- Opening a production promotion PR.
