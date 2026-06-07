Added one regex line to VISION_MODEL_PATTERNS in src/dashboard/lib/chat/vision-support.ts:
`/minimax-m3/` — a family-level pattern matching the lowercased spec
(`minimax/MiniMax-M3` → `minimax/minimax-m3`). Mirrors the existing family-level
entries (`/claude-3/`, `/gpt-5/`, `/mistral-medium-3/`).

Regression guard: the substring `minimax-m3` is NOT in any M2.x spec
(`minimax-m2.7-highspeed`, `minimax-m2`), so the existing text-only cases for
M2.7 in tests/unit/chat/vision-support.spec.ts stay false. Tests added three
M3 cases (`M3`, `M3.0`, `M3.5-highspeed`) to the visionModels array — they
were red before the fix, green after.

Format gate followup: the verify gate tripped on 4 pre-existing prettier
issues (FilesPage, TerminalManager, bridge-fly, terminal-bridge-fly.spec) that
existed on the branch before this fix (confirmed via `git stash` + format
check). Ran `prettier --write` on those 4 files so the gate could ratify the
real fix. Mechanical formatting only — no behavior changes in those files.
