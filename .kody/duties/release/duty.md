# Release

## Job
Run the single branch-aware `release` executable.

The executable reads `.kody/variables.json` `RELEASE_FLOW`:
- single-main repos open the version PR to `main`
- dev/main repos open the version PR to `dev`, then a promotion PR to `main`

## Allowed Commands
- Run `release` executable.

## Restrictions
- Manual only.
- Do not tag before the version PR is merged.
- Do not merge production PRs automatically.
