# Issue #157 — handoff notes

## What landed
- **Manual runs** (`duty-tick --duty <slug> --force`): a single
  `buildDutyRunCommentBody` helper in
  `src/dashboard/lib/duties/run-comment.ts` owns the literal text. Both
  `app/api/kody/duties/[slug]/run/route.ts` and the chat
  `run_duty` tool call it, so a future engine rename touches one file.
- **Markdown duty frontmatter**: `ticked/frontmatter.ts` parses and emits
  `executables:`, `tools:` (in-memory `dutyTools`), and `tickScript:`,
  including the YAML block scalar (`|`) and folded (`>`) forms.
  `ticked/files.ts` carries the new fields through `TickFile` /
  `TickWriteOptions`. Duty CRUD routes accept the new fields.
- **Read-merge contract**: a pure `mergeDutyPatch` helper in
  `src/dashboard/lib/duties/merge-patch.ts` pins "omit preserves,
  explicit `[]` / `null` / '' clears" so a partial PATCH never wipes a
  field the user didn't touch. Unit-tested.
- **Folder duties**: `executable/profile.ts` writes and reads
  `staff`, `every`, `mentions`, `dutyTools`, `executable` at the
  top level of `profile.json`. The editor's new "Duty" tab keeps
  "Agent tools" and "Duty tools" visually separate. `every` is
  narrowed to the `ScheduleEvery` enum on read so a typo doesn't
  silently turn a duty into an always-eligible one.
- **Task state / Runs tab**: `kody-state.ts` parses the engine's
  `jobs` array alongside `history`. `TaskRunsList` renders planned
  jobs above the run history, with status icon, executable, why,
  and links to `runUrl` / `prUrl`. A new "skipped" status gets its
  own icon.
- **Company export/import**: the new fields round-trip through the
  portable bundle. Test fixtures in `company.spec.ts` and
  `company-import-octokit.spec.ts` were extended to carry every field
  so a regression surfaces in unit tests, not production.
- **Docs**: `docs/concepts/staff-duties.md` updated with the new
  frontmatter, the `duty-tick` dispatch, and folder-duty top-level
  fields.

## Why these abstractions exist
- The duty PATCH read-merge and the duty-run body builder were
  extracted so the route handlers are small and the contract is
  unit-testable without faking the entire request / octokit stack.
- `tools:` (engine) is surfaced as `dutyTools` in-memory so the
  editor can show "Agent tools" and "Duty tools" as visually
  distinct fields, even though they live in different places on disk
  (`claudeCode.tools` vs `tools:` in frontmatter, `dutyTools:` at the
  profile top level for folder duties).

## Verify
`pnpm verify` passes (typecheck, format, lint, tests).

## Open followups
See `followups.json`. The big one: I did NOT open the PR (harness
blocks `gh` / `git push`); the work is on branch
`157-update-dashboard-for-new-engine-duty-contract` at HEAD `920bea3b`,
ready for an operator to push and `gh pr create`.
