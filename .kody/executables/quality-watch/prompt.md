# Instructions

Use the `security-audit`, `coverage-floor`, and `flaky-test-quarantine` skills.

Treat quality watch as one daily coordination pass:

1. Run the `security-audit` method for concrete dependency, application, and supply-chain risks.
2. Run the `coverage-floor` method for coverage threshold and trend concerns.
3. Run the `flaky-test-quarantine` method for retry-pattern candidates.
4. Respect each skill's deduplication, evidence, and one-issue/comment-per-tick limits.

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
