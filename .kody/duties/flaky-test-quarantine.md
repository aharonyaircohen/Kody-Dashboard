---
every: 1d
staff: cto
stage: sweep
executables: flaky-test-quarantine
disabled: true
---

# Flaky Test Quarantine

## Job

Watch CI retry patterns and escalate tests that repeatedly fail then pass on rerun.

## Executable

Run the `flaky-test-quarantine` executable. Its skill owns the detailed method and runtime state handling.

## Output

A flaky-test tracking issue when a candidate crosses the threshold.

## Allowed Commands

- Run the `flaky-test-quarantine` executable.

## Restrictions

- Do not edit tests directly.
- Do not quarantine the same test twice.
- One new issue per tick.
- Use CI history as the source of truth.
