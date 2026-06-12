---
name: task-memorize
description: Turn task and execution experience into durable `.kody/memory/` entries.
---

# Task Memorize Skill

Use this skill when the `task-memorize` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

## Job

Scan task and execution artifacts for durable lessons:

- `.kody/tasks/*/memory-recs.json`
- `.kody/tasks/*/handoff-notes.md`
- `.kody/tasks/*/followups.json`
- `.kody/tasks/*/context.json`
- `.kody/sessions/*.jsonl`

For each unprocessed source:

- `confidence: high` → **write directly** to `.kody/memory/<name>.md`
  with frontmatter and update `INDEX.md`. No inbox, no middleman.
- `confidence: medium` → leave attached to the task; do not promote.
- `confidence: low` → ignore.
- no explicit confidence → promote only when the lesson is concrete,
  repo-specific, repeatable, and useful for future work.

The source artifact stays in place either way. This job only decides what
becomes permanent memory.

## Tick procedure — REQUIRED

The executable method:

1. Glob task artifacts and session logs.
2. For each task without a `.memorized` marker:
   - Validates each rec (`type`, `name`, at least one of
     body/why/how_to_apply; rejects reserved names like `index`).
   - Writes `.kody/memory/<name>.md` with frontmatter
     (name, title, type, source, recorded_at) and body composed from
     body + why + how_to_apply + source-task link.
   - Updates `INDEX.md` (replaces existing line for the name, or
     appends a new one).
3. If no `memory-recs.json` exists, inspect handoff notes, followups,
   context, and linked session logs. Extract only high-confidence lessons.
4. After processing a task, touches `.kody/tasks/<id>/.memorized`.
5. For standalone session logs not linked to a task, write only clear
   durable lessons and touch `.kody/sessions/<file>.memorized`.
6. Commits and pushes if anything was written. Suppress with
   `TASK_MEMORIZE_NO_COMMIT=1` for dry runs.

## Restrictions

- Never edit `.kody/tasks/*/memory-recs.json` — that's the task's
  artifact. The task record is the source of truth.
- The marker file `.memorized` is the dedup record; deleting it forces
  re-processing of that task.
- Treat old `.extracted` markers as already processed if they exist.
- Reserved memory filenames (`index`, `readme`) are blocked.
- Do not store generic coding tips. Store only repo-specific or user-specific
  lessons.
- Do not compact memory here. Memory compaction is handled by `compact-memory`.

## Scope

This job remembers what future runs need to avoid repeating mistakes:

- user preferences
- recurring project facts
- repo-specific workflows
- known tool pitfalls
- implementation decisions that affected later work
- execution failures that are likely to happen again
