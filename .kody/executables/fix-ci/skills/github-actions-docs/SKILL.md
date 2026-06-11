---
name: github-actions-docs
description: Ground GitHub Actions workflow fixes in current official docs.
source: https://www.skills.sh/xixu-me/skills/github-actions-docs
---

# GitHub Actions Docs Skill

Use this skill for CI workflow design, debugging, or repair.

## Rules

- Treat workflow syntax, permissions, triggers, matrices, caches, artifacts, and secrets as doc-sensitive.
- Prefer official GitHub Actions docs over memory.
- For CI fixes, change the smallest workflow/code surface that explains the failure.
- Do not hide failures with retries, skipped checks, or weakened tests unless the issue explicitly asks for that.
- Explain the failing job, root cause, and why the fix is safe.
