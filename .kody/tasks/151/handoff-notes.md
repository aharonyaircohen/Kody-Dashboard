# Publish to Vercel executable — handoff

Added `.kody/executables/publish-vercel/` (profile.json + prompt.md) so
`@kody publish-vercel` triggers a Vercel deploy hook for one or more
`vercel:<account>:<project>` labels on the issue.

## How it works

- Profile: comment-only `primitive` with `kind: "oneshot"`. No `lifecycle`
  / `lifecycleConfig` (the engine only allows `pr-branch` there, and
  this is not a code change). Preflight sets a `kody:publishing-vercel`
  label, loads the issue, and composes the prompt. Postflight parses
  the agent's reply and posts it as a comment via `postAgentComment`.
- Prompt: the agent scans the labels, builds the `VERCEL_HOOK_<ACCT>_<PROJ>`
  env-var name (uppercase, non-alphanumeric → `_`), reads the URL from
  that env var, and `curl -X POST`s to it. The URL comes from the
  vault via the engine's `mirrorVaultToActionsSecrets` step
  (`src/dashboard/lib/engine/install.ts`), which decrypts
  `.kody/secrets.enc` and copies each entry to the consumer repo's
  GitHub Actions secrets — that's how the env var resolves at runtime.
- Three failure modes are handled in the comment body (not as FAILED):
  no `vercel:*` labels, missing secret, curl error. A real FAILED is
  only for "engine context missing" type situations.

## Sibling I mirrored

- `.kody/executables/plan/profile.json` — cleanest comment-only shape.
- `.kody/executables/research/profile.json` — same preflight pattern
  (`setLifecycleLabel` + `loadIssueContext` + `composePrompt`).

## What was tested

`tests/unit/executables/publish-vercel.spec.ts` reads both files and
asserts: profile validates against the engine's `validateProfile`,
exact `preflight` / `postflight` script names, the `--issue` input
shape, the read-only `Bash`-only tool list, and the load-bearing
strings in the prompt (label regex, secret-naming rule + worked
example, env-var read, comment-not-FAILED on missing label, the
mandatory DONE / PR_SUMMARY footer).

## Untestable in the dashboard

The actual label-parse → env-var → POST → comment flow runs in the
kody-engine on GitHub Actions. The dashboard has no runtime hook to
exercise it, so the strongest smoke we can do locally is the
profile/prompt pin above. A live end-to-end run is needed to confirm
the engine wires the vault-mirrored env var and the postflight
actually posts the comment — flagged in followups.
