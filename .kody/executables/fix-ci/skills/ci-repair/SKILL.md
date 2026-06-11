# CI Repair

Use this skill when a CI workflow is failing and the job is to fix the root
cause on the PR branch.

## Failure classification

- Compile/type error: fix the code to satisfy the compiler. Do not add `any`,
  ignore comments, or type suppressions to dodge the error.
- Failing test: read the test and code under test. Fix the code unless the test
  demonstrably encodes the wrong expectation.
- Lint/format: run the formatter or make the smallest compliant edit.
- Missing dependency: decide whether the dependency belongs in the manifest or
  whether the import path is wrong. Do not install transitive dependencies just
  to silence a failure.
- Build/packaging: read the real error and fix the export/config/module issue.
- Flaky/non-deterministic: do not add retries or sleeps to mask it. Report the
  flake when local and retry evidence shows nondeterminism.
- Environmental: fail with the infrastructure reason when code cannot fix it.

## Workflow

1. Read the failing-step log and classify the failure.
2. Make the smallest root-cause edit. Do not bundle unrelated cleanup.
3. Call the configured verify tool before reporting success.
4. If verification fails, fix the introduced root cause and retry within the
   allowed attempts.

## Never make CI green by hiding failure

- Do not add type/lint suppressions for real errors.
- Do not skip, todo, comment out, or weaken tests.
- Do not blindly update snapshots.
- Do not loosen matchers to accept unexpected output.
- Do not add retries, retry decorators, sleeps, or disabled workflow steps.
- Do not pin an older dependency only to avoid a new valid failure.
