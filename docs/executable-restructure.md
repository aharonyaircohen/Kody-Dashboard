# Current executable restructure

This tracks the cleanup of the repo-stored executables under
`.kody/executables/`.

## Baseline rules

- `profile.json` owns wiring: lifecycle, model, tools, skills, scripts,
  postflight, and output action types.
- `prompt.md` owns only runtime glue: the issue/PR/report context, which
  skills/scripts/tools to use, and the final response contract.
- `skills/<name>/SKILL.md` owns reusable method: rubrics, workflows, review
  standards, research floors, QA checklists, and examples.
- `*.sh` owns deterministic work.
- No-agent executables should not have agent output contracts.
- Built-in executables with custom postflight parsers must keep their custom
  final response contract as the last instruction. They must not receive the
  generic generated dashboard contract.

## Current state

| Executable      | Shape                  | Current status                                                                                                                                                                                          | Next restructuring target                                |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `company-graph` | deterministic no-agent | Clean reference shape: tiny instructions, local skill, local shell script, `skipAgent`.                                                                                                                 | None.                                                    |
| `spec`          | no-agent orchestrator  | Cleaned to a tiny no-agent note.                                                                                                                                                                        | None unless the spec transition logic moves to a script. |
| `bug`           | agent PR               | Restructured: persona removed, custom output contract is last, local `systematic-debugging` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final contract.       | None beyond future wording polish.                       |
| `feature`       | agent PR               | Restructured: persona removed, custom output contract is last, local `implementation-session` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final contract.     | None beyond future wording polish.                       |
| `chore`         | agent PR               | Restructured: persona removed, custom output contract is last, local `chore-session` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final contract.              | None beyond future wording polish.                       |
| `fix-ci`        | agent PR               | Restructured: persona removed, custom output contract is last, local `ci-repair` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final contract.                  | None beyond future wording polish.                       |
| `fix`           | agent PR               | Restructured: persona removed, `FEEDBACK_ACTIONS` contract is last, local `feedback-application` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final contract.  | None beyond future wording polish.                       |
| `classify`      | agent comment          | Restructured: persona removed, classification contract is last, local `issue-classification` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final contract.      | None beyond future wording polish.                       |
| `plan`          | agent comment          | Restructured: persona removed, plan marker reminder is last, local `implementation-planning` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final contract.      | None beyond future wording polish.                       |
| `reproduce`     | agent comment          | Restructured: persona removed, repro contract is last, local `bug-reproduction` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final contract.                   | None beyond future wording polish.                       |
| `research`      | agent comment          | Restructured: persona removed, research marker reminder is last, local `issue-research` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final contract.           | None beyond future wording polish.                       |
| `review`        | raw markdown review    | Restructured: persona removed, raw-review response reminder is last, local `code-review` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final response reminder. | None beyond future wording polish.                       |
| `qa-engineer`   | raw markdown QA report | Restructured: persona removed, raw-QA response reminder is last, local `qa-session` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final response reminder.      | None beyond future wording polish.                       |
| `ui-review`     | raw markdown UI review | Restructured: persona removed, raw-review response reminder is last, local `ui-review` skill exists and loads with `buildSyntheticPlugin`, prompt is reduced to context/glue/final response reminder.   | None beyond future wording polish.                       |

## Completion notes

- Keep `company-graph` and `spec` as the no-agent reference shapes.
- Every skill-backed executable now has `buildSyntheticPlugin` before prompt
  composition or before the flow script that composes the prompt.

Do not migrate by moving the whole prompt into a skill. Runtime context
templates such as `{{issue.body}}`, `{{prDiff}}`, `{{qaContext}}`, and the final
response contract belong in `prompt.md`.
