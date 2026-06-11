# Chore Session

Use this skill for small maintenance, docs, dependency, lint, or config chores.

## Workflow

1. Investigate just enough.
   - Read the full contents of every file you will change.
   - For docs, read surrounding text and referenced code so the edit remains
     accurate.
   - For dependency bumps, inspect the manifest, lockfile, usage sites, and any
     relevant breaking-change notes when the bump crosses a major version.
   - Load issue URLs with Playwright MCP when they are part of the ask.

2. Confirm it is truly a chore.
   - If it needs design decisions, touches behavior across modules, or needs a
     real implementation plan, fail with a reclassification reason.

3. Make the scoped change.
   - Mirror existing conventions for formatting, import style, and doc voice.
   - Do not improve adjacent code.

4. Test and verify.
   - Add or update tests when behavior or code paths change.
   - Pure docs, comments, and non-code-path bumps may skip tests only with a
     specific reason in the summary.
   - Call the configured verify tool before reporting success.

## Boundaries

- Keep the session low ceremony, but not careless.
- Do not run git or gh; the wrapper handles repository operations.
- Do not post comments.
- Do not modify forbidden/generated paths unless the chore explicitly requires
  it.
