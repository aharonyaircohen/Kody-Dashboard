# PR Feedback Fix

## Job

Apply review feedback to an existing pull request branch.

## Executable

Run the `fix` executable. Its feedback application skill owns the detailed method.

## Output

Updated commits on the existing pull request branch with a clear final status.

## Allowed Commands

- Run the `fix` executable.

## Restrictions

- Only act on the target pull request.
- Preserve the original PR intent.
- Do not open a separate replacement PR unless the executable explicitly fails and reports why.
