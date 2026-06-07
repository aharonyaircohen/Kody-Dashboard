# PR #55 merge-conflict resolution

Three files conflicted after `git merge origin/main` into `48-featdocs-read-only-docs-page-in-dashboard-mirror-c`. Resolved by taking **origin/main's side in every case** — the HEAD-side blocks referenced symbols deleted by main's recent refactors and would not typecheck.

## Files

- `src/dashboard/lib/components/DashboardHome.tsx` — dropped the `DutiesHealth` function (HEAD) in favor of main's "restored sections" comment. `DutiesHealth` called `useDuties()`, which main removed from the imports, and the new 2x2 grid layout (Goals/Channels/Reports/Engine) doesn't reference it. The function was dead code in HEAD.
- `src/dashboard/lib/components/ExecutablesManager.tsx` — replaced the Card-wrapped list row (HEAD, with `Run`/`Edit`/`Delete` buttons and `legacy`/`markdown` badges) with the `<ExecutableRow>` component (main). HEAD's row referenced the removed `setRunning` state, the removed `Play` icon, and the removed `legacy`/`markdown` summary fields. `ExecutableRow` is defined later in the same file (master/detail pattern).
- `src/dashboard/lib/executables/files.ts` — kept the single-directory `listFolderDuties` call (main) instead of HEAD's `FOLDER_DIRS`/`listFolderDutiesInDir`/`listMarkdownDutySummaries` triplet. The HEAD symbols are not defined anywhere in the current codebase, and the `legacy`/`markdown`/`dir` fields HEAD wrote into `ExecutableSummary` aren't on the type.

## Verification

- `pnpm typecheck` — clean (0 errors)
- `pnpm lint` — 0 errors, only pre-existing warnings (none in the touched hunks)
- `pnpm prettier --check` on the three files — clean
