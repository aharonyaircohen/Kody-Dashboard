Issue #120 (doc coverage gap for `src/dashboard/lib/previews/`) was a pure documentation task: add `@ai-summary` JSDoc tags to all 14 modules and a folder-level header to the most-central file. No code logic changed, so no tests needed updating.

I added the `@ai-summary` tag in the JSDoc block of every file, after the existing `@pattern` tag. Each summary captures the *why* and the *trap* (the non-obvious gotcha an agent reading the file cold would otherwise miss) — e.g. preview-key.ts warns that the hash scheme is a silent contract, fly-previews.ts calls out the autostop/autostart vs fly.toml name bug, vault-build-context.ts flags that `NEVER_PASS_TO_BUILD` strips infra creds before they leak into a public image.

The folder-level header went into `preview-lifecycle.ts` since there is no `index.ts`. It includes a module map and five load-bearing gotchas: per-repo billing, no dashboard-side preview state, app-name stability as a contract, static previews are not git-backed, and Fly is preferred over GitHub for the build step.

`pnpm verify` (typecheck + lint + tests) passed on the first attempt.
