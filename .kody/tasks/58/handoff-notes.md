# Task 58 — Resolve PR #58 merge conflicts

## What

PR #58 (`57-secrets-add-master-key-unlock-to-the-secrets-page`) was opened
against a stale snapshot of `ExecutablesManager.tsx` and
`executables/files.ts`. Meanwhile `main` advanced and commit
**9986e2c0 "feat(dashboard): improve operator triage"** simplified both
files substantially: it deleted the Card-based list rendering and the
`ExecutableRow` component (in `ExecutablesManager.tsx`), and dropped the
`FOLDER_DIRS` / `listMarkdownDutySummaries` / `dir` / `legacy` / `markdown`
machinery (in `files.ts`).

The PR's only edits to these two files were two whitespace-only line-wraps,
both on code paths that the main-branch refactor removed.

## Resolution

Took `origin/main` on both conflicts. The PR's line-wraps were on code
that no longer exists, so preserving them would have meant re-introducing
the deleted abstractions. After the resolution both files are
byte-identical to `origin/main`.

## Verification

- `pnpm typecheck` — clean
- `pnpm lint` — 0 errors, 120 pre-existing warnings (same as on `main`)
- `pnpm test` — 1117 passed, 10 skipped (matches `main`)
