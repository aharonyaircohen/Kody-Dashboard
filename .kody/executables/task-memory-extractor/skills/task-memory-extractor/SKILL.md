---
name: task-memory-extractor
description: Promote high-confidence task memory recommendations into permanent `.kody/memory/` entries.
---

# Task Memory Extractor Skill

Use this skill when the `task-memory-extractor` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

## Job

Scan `.kody/tasks/*/memory-recs.json` files (written by executors at
task end per the AGENTS.md memory protocol). For each unprocessed
recommendation:

- `confidence: high` → **write directly** to `.kody/memory/<name>.md`
  with frontmatter and update `INDEX.md`. No inbox, no middleman.
- `confidence: medium` → leave attached to the task; do not promote.
- `confidence: low` → ignore.

The recommendation stays in the task's `memory-recs.json` either way;
this job only decides what becomes a permanent memory file.

## Tick procedure — REQUIRED

The executable method:

1. Globs `.kody/tasks/*/memory-recs.json`.
2. For each task without a `.extracted` marker:
   - Validates each rec (`type`, `name`, at least one of
     body/why/how_to_apply; rejects reserved names like `index`).
   - Writes `.kody/memory/<name>.md` with frontmatter
     (name, title, type, source, recorded_at) and body composed from
     body + why + how_to_apply + source-task link.
   - Updates `INDEX.md` (replaces existing line for the name, or
     appends a new one).
3. After processing a task, touches `.kody/tasks/<id>/.extracted`.
4. Commits and pushes if anything was written. Suppress with
   `TASK_MEMORY_EXTRACTOR_NO_COMMIT=1` for dry runs.

## Restrictions

- Never edit `.kody/tasks/*/memory-recs.json` — that's the task's
  artifact. The task record is the source of truth.
- The marker file `.extracted` is the dedup record; deleting it forces
  re-processing of that task.
- Reserved memory filenames (`index`, `readme`) are blocked.

## Scope

What this job remembers is **what the executor judged worth
remembering at task end**. It does not regenerate or re-evaluate
recommendations — that judgment belongs to the executor that ran the
task with full context.
