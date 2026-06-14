# PR #68 — Review feedback round

Two items from the review, plus one blocking format drift:

1. **Reformatting noise.** Reverted the 22 prettier-only source files from
   commit 3eaf9c3a (DutyControl.tsx, DashboardHome.tsx, TriageStrip.tsx,
   app/api/kody/brain/stored/route.ts, app/api/kody/ci/rerun/route.ts,
   docs/company.md, docs/executables.md, BrainFlyCard.tsx,
   BranchPreviewCard.tsx, CreateTaskDialog.tsx, ExecutablesManager.tsx,
   HappeningNow.tsx, JobsManager.tsx, RunnerManager.tsx,
   VaultLockedBanner.tsx, src/dashboard/lib/executables/files.ts,
   useDashboardActions.ts, useTriageStrip.ts, useVaultStatus.ts,
   brain-fly.ts, litellm-fly.ts, tests/unit/engine/install.spec.ts) back
   to their pre-prettier state. Kept `.prettierignore` — it's load-bearing
   for the `format:check` gate (excludes `.kody/`).

   Net effect: the PR's behavioral surface is now the chat-thread feature
   (9 files) + `.prettierignore` + the orphan deletion below. The 22-file
   reformatting is tracked as a followup chore.

2. **Orphan file.** Deleted `src/dashboard/lib/staff-chat-local.ts`. No
   imports anywhere in the codebase (verified by grep). Mirrors the
   `task-chat-local.ts` / `duty-chat-local.ts` deletions in #66 — same
   role, sibling file, made dead code by the unified thread.

3. **Format drift blocker.** kody.config.json had a 2-line pre-existing
   prettier drift (inline `operators` array, missing trailing newline)
   that the original prettier commit didn't touch. Inlined the array and
   added the trailing newline so `format:check` passes — this round's
   verify gate unblocked. Trivial change, but load-bearing for CI.
