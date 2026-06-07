# Issue #113 — Docs coverage for `src/dashboard/lib/previews/`

Added a central `index.ts` (folder-level @ai-summary + re-exports of the
public surface) and inserted an @ai-summary line in each of the 14 leaf
files, matching the convention used elsewhere in `src/dashboard/lib/`
(e.g. `agents.ts`, `commands/index.ts`, `executables/index.ts`).

The existing previews files already had `@fileType` / `@domain` /
`@pattern` headers with rich bodies. The new @ai-summary lines capture
the WHY (and, where applicable, the trap) — the autostop/autostart
field-name trap in `fly-previews.ts`, the per-repo billing gotcha in
`config.ts` and the index, the NEVER_PASS_TO_BUILD deny-list in
`vault-build-context.ts`, the Fly-preferred / GitHub-fallback inversion
in `preview-router.ts`, and the deterministic-naming trade-off in
`preview-key.ts` / the index.

Index.ts re-exports all leaf modules via `export * from` — no name
collisions across the 14 files. All existing imports use specific leaf
paths (verified by grep), so the new index is additive and does not
change any import resolution.

Verify passed on the first attempt: typecheck, lint, and tests all green.
