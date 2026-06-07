Resolved `git merge origin/main` conflicts in `src/dashboard/lib/previews/fly-previews.ts` for PR #76 (static previews — opt-in health check).

Two conflict regions, both took the HEAD (PR) side:

1. **JSDoc on `CreatePreviewMachineInput.healthCheck` (lines 44–51)** — HEAD wording is more precise: it names the builder config flag (`fly.previews.healthCheck`) the option mirrors, and the framing matches the PR's intent (default off, opt in for health-gated previews). Main's wording was more anecdotal about the static-preview regression.
2. **Inline comment in `createMachine` (lines 230–233)** — HEAD adds a four-line rationale comment explaining why the default is no `checks` block (a 15s ping marks the machine "active" forever, defeating `autostop: "suspend"`). Main deleted it. Kept the comment — it documents a non-obvious gotcha that a future reader will hit.

Verification: `pnpm typecheck` (0 errors), `pnpm lint` (0 errors, only pre-existing warnings in test files, none in fly-previews.ts), `pnpm format:check` (clean). The `checks` body itself (httpget, 15s interval, 10s timeout, 30s grace) is unchanged in both sides — only the comment framing differed.
