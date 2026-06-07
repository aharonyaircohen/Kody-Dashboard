Removed the github-budget.ts module and all its usage.

Changes made:
- Deleted `src/dashboard/lib/github-budget.ts` (109 lines — the entire budget circuit breaker file)
- `src/dashboard/lib/github-client.ts`: removed the import of `assertBudget`, `methodKind`, `recordResponseHeaders` from `./github-budget`, removed the `attachBudgetHooks` function definition, and removed its 3 call sites in `setGitHubContext`, `getOctokit`, and `createUserOctokit`
- `app/api/kody/health/route.ts`: removed `getBudget` import and removed `budget: getBudget()` from the health response JSON

No tests reference the budget module directly. The existing github-client tests (cache + GraphQL) pass unchanged. Format failures in KodyChat.tsx and reasoning.spec.ts are pre-existing and unrelated to this change.
