# Issue Classification

Use this skill to classify a GitHub issue into exactly one flow type.

## Flow types

- `feature`: new user-facing capability, refactor, performance work, or
  anything where scope is not fully known up front. Use when the issue opens a
  design space, even if the visible change looks small.
- `bug`: broken behavior, enhancement to an existing feature, or a targeted
  localized change with clear scope.
- `spec`: design doc, RFC, architecture proposal, analysis, or exploration
  artifact with no code change requested.
- `chore`: trivial maintenance such as docs tweaks, dependency bumps, lint
  fixes, or README updates with no real design choice.

## Precedence

- If the issue asks for an RFC, design doc, spec, or analysis with no
  implementation, choose `spec`.
- If it plainly asks to fix or add a tiny bounded behavior, choose `bug`.
- If it is mechanical maintenance, choose `chore`.
- Otherwise choose `feature`.
- Body and comments beat labels. Labels are hints and are often stale.

## Disambiguation

- A label of `bug` plus a body that opens investigation across multiple
  subsystems is `feature`.
- A body that asks for root-cause analysis or recommendations without code is
  `spec`.
- A dependency bump or typo fix mislabeled as `feature` is `chore`.
- A docs issue that says "fix docs OR code so they match" is `bug`, because it
  requires a real decision.

## Boundaries

- Read only.
- Do not modify files.
- Do not run git or gh.
- Do not overthink beyond the rubric; pick the single best flow.
