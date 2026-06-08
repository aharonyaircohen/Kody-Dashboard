Issue #111: after clicking Approve in the preview action bar, no manual merge button was visible — only a disabled "Approved" badge. The auto-merge useEffect did fire when CI turned green, but a user who wanted to retry / force-merge had no UI affordance.

Fix: imported the existing `MergeButton` component into `src/dashboard/lib/components/PreviewActions.tsx` and rendered it inside the approval row, gated on `isUIApproved && isPRApproved`. The auto-merge effect is preserved as the primary trigger; the manual button is a supplement. Both paths share the same `onMerge` handler from VibePage's `mergeMutation`, so a single React Query mutation handles either entry point.

Test: `tests/unit/preview-actions-merge-button.spec.ts` — source-level structural test (7 cases) that asserts the import, the JSX render, the `isUIApproved && isPRApproved` gate, the prop wiring (`onMerge`, `prNumber`, `prTitle`, `branchName`, `isMerging`), and the preservation of the existing badge + auto-merge effect. Follows the `tests/unit/chat/kody-chat-composer.spec.ts` pattern because the repo has no DOM test infrastructure (`happy-dom` / `@testing-library/react` are not installed and vitest runs in `node` environment).

Verify gate: passed on second attempt (first failed on prettier formatting of the new test file; fixed with `pnpm prettier --write`).
