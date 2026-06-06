Resolved the 3 remaining merge conflicts from `git merge origin/main` into PR #40.

**Strategy:** For all three conflicted files, took the `origin/main` version (via `git checkout origin/main -- <file>` + `git add`). These are auto-generated/encrypted artifacts where main's latest copy is authoritative — the PR's "Files browser" feature has no dependency on their content.

**Per-file notes:**

- **`.kody/context/todo.md`** — marked "deleted by us" in the merge (the PR branch deleted it; main kept it). The file on disk already held main's content, so the resolution was to `git checkout origin/main --` and `git add` to confirm retention. Restoring the file (rather than allowing the deletion to stand) preserves the live context that the duties read.
- **`.kody/reports/ceo-performance-review.md`** — auto-regenerated weekly report. Took main's version, which contains the "fourth consecutive week" cadence note, the corrected analysis that the `dev` branch *does* exist (the prior note that it didn't was wrong), and the kody `steady`→`idle` reclassification based on the actual `staff:` frontmatter rules.
- **`.kody/secrets.enc`** — AES-256-GCM-encrypted secrets blob. Always take main's version; the live main copy is the source of truth and the encrypted payload cannot be merged by hand.

**Verification:** `grep` for `<<<<<<<` / `=======` / `>>>>>>>` in all three files returns nothing. `git status --porcelain | grep "^UU\|^DU\|^UD"` returns nothing (no unmerged paths). `git diff --stat origin/main --` the three files is empty — they are byte-identical to main.
