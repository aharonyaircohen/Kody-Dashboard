---
every: 30m
staff: coo
stage: sweep
executables: task-memory-extractor
disabled: true
---

# Task Memory Extractor

## Job

Promote high-confidence task memory recommendations into permanent `.kody/memory/` entries.

## Executable

Run the `task-memory-extractor` executable. Its skill owns the detailed method and runtime state handling.

## Output

New or updated memory files and index entries when high-confidence recommendations exist.

## Allowed Commands

- Run the `task-memory-extractor` executable.

## Restrictions

- Never edit the source task recommendation file.
- Do not promote medium or low confidence recommendations.
- Use extraction markers to avoid duplicates.
- Do not overwrite reserved memory filenames.
