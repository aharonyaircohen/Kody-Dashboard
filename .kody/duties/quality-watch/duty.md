# Quality Watch - security, coverage, and flaky-test signals

## Job

Watch daily quality signals: security posture, coverage floor, and flaky-test candidates.

## Executable

Run the `quality-watch` executable. Its skills own the security, coverage, and flaky-test methods.

## Output

A tracking issue, closing comment, trend warning, flaky-test issue, or security nudge when concrete findings need attention.

## Allowed Commands

- Run the `quality-watch` executable.

## Restrictions

- Disabled until the operator enables this grouped watch.
- Do not edit code, tests, dependencies, or branch protection.
- Use CI and GitHub evidence as the source of truth.
- Keep each skill's one-issue/comment-per-tick limit.
