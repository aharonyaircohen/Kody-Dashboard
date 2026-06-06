# Clear Empty Goals

Remove goals which have no tasks at all.

Goals are tracked in this repo's goals manifest (a manifest issue / GitHub
Discussion). Steps:

1. Find the open goals and, for each, check whether it has any associated tasks
   (linked issues / phase issues).
2. If a goal has NO tasks at all, close it as outdated with a short note.
3. Write a short report of what you scanned and what you closed to
   `.kody/reports/clear-empty-goals.md` on the default branch, using
   `gh api --method PUT repos/$GITHUB_REPOSITORY/contents/.kody/reports/clear-empty-goals.md`
   (base64-encode the body; pass the existing file `sha` when updating, omit it
   when creating).

This duty runs on a schedule with no issue attached, so do NOT try to comment on
an issue — the report file is the only output.

<!-- kody:output-format (managed — edit above this line only) -->

# Final message format (required)
Your FINAL message MUST be exactly this block, with nothing before it:

DONE
PR_SUMMARY:
<2–5 bullets: which goals you scanned, which (if any) you closed, and where the report was written>

If you cannot complete the task, output a single line instead: FAILED: <reason>
