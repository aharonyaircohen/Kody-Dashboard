# Issue #125 — doc-coverage gap: src/dashboard/lib/ui-verify/

Added `@ai-summary` headers to all 4 modules. No code or test changes — pure docs.

`apply-label.ts` is the central file (`@pattern folder-root`) and carries the folder-level description: the two-halves shape (trigger + apply), module map, and the load-bearing gotcha that auto-dispatch is disabled due to a re-fire loop. The other three (`dispatch.ts`, `labels.ts`, `verdict.ts`) get focused *why* + *trap* notes — the disabled-dispatch trap, the engine-owned `kody:reviewing-ui` label, and the substring prefilter in the webhook route.

`verify` passed on first attempt (no behavior change, so typecheck/lint/tests are unaffected).

Follow-up captured: re-enabling auto-dispatch needs SHA/preview-URL-keyed dedup. The dispatch.ts module exists for that future path; it's dead in production today.
