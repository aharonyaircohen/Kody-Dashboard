## What happened

`git merge origin/main` into PR #39 produced conflicts in three files, all unrelated to the PR's actual subject (voice-mode wake lock fixes in `useVoiceChat.ts`).

## How I resolved each

**`src/dashboard/lib/components/DashboardHome.tsx`** — HEAD added an unused `DutiesHealth()` function that referenced an unimported `useDuties` hook (would not compile). origin/main added a single section-divider comment. Took origin/main (just the comment line) — the function was dead code (not rendered in the JSX) and would have broken the build.

**`src/dashboard/lib/components/ExecutablesManager.tsx`** — HEAD kept the old inline-list row with all action buttons (Set default / Run / Edit / Delete). origin/main refactored to a master-detail pattern using a new `ExecutableRow` component (already defined later in the file at the post-merge line ~595), where the row only sets `selectedSlug` and the action buttons live in `ExecutableDetail`. Took origin/main — the rest of the file (state, `MasterDetailShell`, `ExecutableDetail` with Star/Edit/Delete buttons) is built for the master-detail pattern, so HEAD's inline buttons would have been a regression and would duplicate the detail-pane buttons.

**`src/dashboard/lib/executables/files.ts`** — HEAD rewrote `listExecutableFiles` to iterate over an undefined `FOLDER_DIRS` constant and call an undefined `listFolderDutiesInDir` helper, plus added a `listMarkdownDutySummaries` export that assigned `dir` / `legacy` / `markdown` fields that don't exist on the `ExecutableSummary` interface (would not typecheck). origin/main kept the simple single-directory implementation. Took origin/main — HEAD's code wouldn't compile and `listMarkdownDutySummaries` has no consumers anywhere in `app/` or `src/`.

## Verification

`pnpm typecheck` passes. `pnpm lint` shows pre-existing warnings only (0 errors); the unused `Dialog*` imports in `ExecutablesManager.tsx` are unrelated to the merge.

## Files staged

`git add` for the three resolved files. The wrapper handles the merge commit.
