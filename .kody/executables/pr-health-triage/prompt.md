# Instructions

Use the `pr-health-triage` skill.

Run only the work requested by the matching duty. Follow the duty frontmatter for cadence, staff, mentions, and safety limits.

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
