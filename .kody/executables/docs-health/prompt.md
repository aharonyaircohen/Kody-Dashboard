# Instructions

Use the `docs-readme` and `docs-code` skills.

Treat documentation stewardship as one daily pass:

1. Run the `docs-readme` method to catch documentation drift from merged PRs.
2. Run the `docs-code` method to catch broad in-code documentation coverage gaps.
3. Respect each skill's deduplication, one-action, and advisory-only limits.

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
