# Handoff — issue #163

## What I did

Added a single new file, `src/dashboard/lib/runners/README.md`, that acts
as the folder-level "start here" pointer the issue asked for. The
header uses the same `@ai-summary` block style that every other file in
the folder uses, then expands into plain markdown.

The README covers, in order:

1. **What the folder is** — the Fly Machines + GitHub Actions runner
   layer, with a back-link to `CLAUDE.md → PR previews on Fly Machines`
   for the architecture overview.
2. **Start-here pointers** — `runner-router.ts` (entry decision, pure),
   `runner-dispatch.ts` (orchestrator), `fly.ts` + `fly*.ts`
   (per-feature Fly clients). The issue's exact framing.
3. **Folder layout table** — every one of the 15 files tagged with its
   concern (GitHub Actions routing / Fly Machines / Activity
   persistence) and a one-liner.
4. **Dispatch flow diagram** — ASCII tree from `resolveFlyContext` →
   `dispatchRun` → `chooseRunner` → pool claim → `spawnRunner`.
5. **Load-bearing gotchas** — five rules with the
   `FLY_API_TOKEN`-from-vault rule first, plus `account` ≠ `owner`,
   pool-never-throws, fail-open health probe, and one-shot vs
   persistent surfaces.
6. **Extending the folder** — three patterns (new Fly surface / new
   runner dimension / new activity metric) tied to the existing
   in-folder exemplars (`litellm-fly.ts`, `runner-router.ts` +
   `DispatchDeps`, `fly-activity.ts`).

## Why a README, not an `index.ts`

- The folder mixes three concerns with no clear single public surface
  to re-export. A re-export `index.ts` would either dump 15 modules
  (defeating the "public surface" purpose) or pick a subset
  arbitrarily.
- The `builder/` folder precedent is a README at the folder root, used
  for the same "where do I start?" purpose.
- `src/dashboard/lib/{branches,executables,commands,hooks,notifications/channels}/index.ts`
  files all exist to re-export stable public surfaces; `runners/`
  doesn't have one to re-export.

## Other edits in this commit

`verify()` failed on the first attempt because `pnpm format:check`
flagged four files with pre-existing line-wrap failures that are
unrelated to this issue:

- `app/api/kody/docs/route.ts`
- `src/dashboard/lib/components/KodyChat.tsx`
- `tests/unit/auth-me.spec.ts`
- `tests/unit/files-page.spec.ts`

I ran `npx prettier --write` on each. The diffs are line-wrap only
(9 insertions, 13 deletions, no logic change). Reviewers can drop them
from the PR if they prefer — they were required to clear the verify
gate. None of these files are inside the issue's scope.

## Verification

- `pnpm prettier --check` → clean.
- `mcp__kody-verify__verify` → `ok: true`.
