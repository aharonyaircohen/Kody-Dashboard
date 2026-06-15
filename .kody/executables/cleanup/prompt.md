# Instructions

Use the `clear-empty-goals`, `cleanup-branches`, `dependency-bump`, and `dead-code-sweep` skills.

Treat cleanup as one grouped housekeeping pass:

1. Run the `clear-empty-goals` method for empty goals with no tasks.
2. Run the `cleanup-branches` method for stale task branches whose linked task is closed, done, or failed.
3. Run the `dependency-bump` method for stale production dependencies and in-flight bump limits.
4. Run the `dead-code-sweep` method for unused exports, files, and dependency cleanup candidates.
5. Respect each skill's safety, deduplication, and one-action limits. Prefer a quiet no-op over speculative cleanup.

Run only the work requested by the matching duty. Follow the duty profile metadata for cadence, staff, mentions, and safety limits.

# Final message format (required)

Your final message must use this exact shape:

```
DONE
PR_SUMMARY:
- <short summary of what happened>
```

If you cannot complete the run, output one line instead:

```
FAILED: <reason>
```
