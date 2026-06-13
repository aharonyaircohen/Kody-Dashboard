# Issue Classification

## Job

Classify an issue and dispatch the matching duty action for the work.

## Executable

Run the `classify` executable. Its issue-classification skill owns the routing rules.

## Output

One selected follow-up duty action, such as `feature`, `bug`, `spec`, or `chore`.

## Allowed Commands

- Run the `classify` executable.

## Restrictions

- Do not implement code directly from this duty.
- Dispatch only one matching work duty unless the issue explicitly requires a split.
- Prefer existing labels when they are clear.
