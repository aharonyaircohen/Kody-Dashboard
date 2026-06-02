## What was failing

The E2E Tests workflow (GitHub Actions run 26825164641) had two distinct problems:

1. **Environmental `vercel deploy` failure** (the reported failure): `vercel deploy --token=***` exited with code 1 in the `deploy-preview` job. The output was truncated in the logs so the root cause (auth/project/network) is unknown.

2. **Pre-existing typecheck + format failures** surfaced when running the quality gates via `mcp__kody-verify__verify`:
   - `tests/int/close-pr-action.int.spec.ts` line 53: TS2556 — spread `(...a: unknown[])` into function call rejected by strict TS.
   - `.kody/reports/ceo-performance-review.md`: Prettier drift.

## What changed and why

**`tests/int/close-pr-action.int.spec.ts`**: Replaced the `(...a: unknown[]) => fn(...a)` spread pattern with `(fn as (...a: unknown[]) => void).apply(null, a)`. The `.apply()` form satisfies TS's strict rest-argument rules without changing runtime behavior. The file was introduced by `d545491` (main) and was not changed by this PR.

**`.kody/reports/ceo-performance-review.md`**: Ran `pnpm format -- .kody/reports/ceo-performance-review.md` to fix Prettier drift. The file was refreshed by `715b319` (main) and was not changed by this PR.

## Root-cause notes

- The `deploy-preview` job that was failing **was already removed** by commit `65eb0fb` ("ci: drop Vercel preview deploy, move PR previews to Fly") which is part of the current branch's history (merged via `ea6dcfb`). A fresh workflow run on the current HEAD will not run `vercel deploy` at all.
- The TS and format errors are pre-existing from main commits `d545491` and `715b319` respectively — they were not introduced by this PR's actual code changes (`useVoiceChat.ts` Wake Lock feature and `install.spec.ts` mock formatting).
