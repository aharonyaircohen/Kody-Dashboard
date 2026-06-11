---
every: 1h
staff: coo
stage: review-loop
executables: report-review-assignment
---

# Report Review Assignment

## Job

Assign new or changed action-needed reports to the right reviewer.

## Executable

Run the `report-review-assignment` executable. Its skill owns the detailed method and runtime state handling.

## Output

One review assignment issue or comment for each report that needs a decision.

## Allowed Commands

- Run the `report-review-assignment` executable.

## Restrictions

- Do not solve report findings.
- Do not install skills or edit source files.
- Do not assign reports without an action-needed review signal.
- Create at most one assignment per report version.
