---
every: manual
staff: coo
stage: simple-check
executables: publish-release
disabled: true
---

# Publish Release

## Job

Create a release-request issue and dispatch the release orchestrator on demand.

## Executable

Run the `publish-release` executable. Its skill owns the detailed method and runtime state handling.

## Output

One release-request issue and release dispatch.

## Allowed Commands

- Run the `publish-release` executable.

## Restrictions

- Manual only.
- Do not publish directly from the duty.
- Do not create duplicate release requests for the same trigger.
- Stop if release prerequisites are unclear.
