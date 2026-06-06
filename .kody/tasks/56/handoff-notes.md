# PR #56 conflict resolution

Resolved three merge conflicts between `47-featpreviews-token-gate-per-pr-fly-previews-signed` and `origin/main`. Took the `origin/main` side in all three cases; the HEAD additions in each conflict block referenced symbols that don't exist in the resolved tree and are unrelated to the PR's preview-token-gating purpose.

## Files

- **`src/dashboard/lib/components/DashboardHome.tsx`** — HEAD added a `DutiesHealth` section that called `useDuties()`, but that hook isn't imported in this file. Removed the function and the surrounding comment placeholder; `LatestReports()` follows the section header directly as on main.

- **`src/dashboard/lib/components/ExecutablesManager.tsx`** — HEAD rewrote the list `<li>` to an inline `Card` with edit/run/delete actions, but the row body referenced `setRunning(e.slug)` (never declared anywhere in the file) and `isIssueDefault` / `isPrDefault` (not in the `.map()` scope). Kept the existing `<ExecutableRow>` component which receives those props from the parent.

- **`src/dashboard/lib/executables/files.ts`** — HEAD replaced `listExecutableFiles` with a multi-folder sweep and added a new `listMarkdownDutySummaries` export. Both referenced `FOLDER_DIRS` and `listFolderDutiesInDir` (not defined in this file) and used `legacy` / `markdown` / `dir` fields that aren't in the `ExecutableSummary` interface. Reverted to the main-branch `listFolderDuties` call; no other call sites depend on the new export.

## Verification

- `pnpm typecheck` — clean
- `pnpm lint` — 0 errors, 124 pre-existing warnings in test files (unrelated)
- `grep '^(<<<<<<<|=======|>>>>>>>)' src` — no matches
