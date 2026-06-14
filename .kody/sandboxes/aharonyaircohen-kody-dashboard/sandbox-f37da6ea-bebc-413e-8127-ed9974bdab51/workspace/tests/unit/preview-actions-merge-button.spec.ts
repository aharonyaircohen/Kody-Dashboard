/**
 * Source-level structural test for the manual Merge button in
 * `PreviewActions.tsx` (issue #111). After both UI and PR approval
 * labels are set, the user must be able to manually trigger the merge
 * from the action bar — the auto-merge effect is not enough on its own
 * because it doesn't help when CI flips green before the user can see
 * the action bar, or when the user wants to retry after a transient
 * failure.
 *
 * The component is a client React component that calls
 * `useQueryClient`, `usePRCIStatus`, and several dialogs — too many
 * hooks to unit-test under a node-environment vitest without
 * `happy-dom` / `@testing-library/react`, neither of which is in the
 * repo. We follow the source-level pattern from
 * `tests/unit/chat/kody-chat-composer.spec.ts` and assert JSX markers
 * directly so a future refactor can't silently drop the manual
 * trigger.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREVIEW_ACTIONS_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/PreviewActions.tsx",
);

const SOURCE = readFileSync(PREVIEW_ACTIONS_PATH, "utf8");

describe("PreviewActions — manual Merge button (issue #111)", () => {
  it("imports MergeButton from the sibling module", () => {
    // Sanity check: the component must reference MergeButton. The import
    // line drives both the JSX render and the prop wiring in the test
    // below, so a missing import would surface as a TypeScript error
    // first — this assertion exists to keep the contract explicit.
    expect(SOURCE).toMatch(
      /import\s*\{\s*MergeButton\s*\}\s*from\s*["']\.\/MergeButton["']/,
    );
  });

  it("renders <MergeButton> in the approval row", () => {
    // The auto-merge effect covers the happy path, but the user must
    // also be able to click a button — the bug was that the only
    // visible control after approval was a disabled "Approved" badge.
    expect(SOURCE, "MergeButton must be rendered as a JSX element").toMatch(
      /<MergeButton\b/,
    );
  });

  it("only renders the manual Merge button once BOTH approvals are recorded", () => {
    // Guard against showing the button pre-approval (CI not yet
    // intentional review) and against leaking it to a PR that was
    // approved UI-only. Both `ui-approved` and `pr-approved` labels
    // must gate the render.
    const mergeBlock = SOURCE.match(
      /\{isUIApproved\s*&&\s*isPRApproved\s*&&\s*\(\s*[\s\S]*?<MergeButton[\s\S]*?\)\s*\}/,
    );
    expect(
      mergeBlock,
      "MergeButton must be wrapped in `isUIApproved && isPRApproved` so it only shows after both approvals are recorded",
    ).not.toBeNull();
  });

  it("wires the manual Merge button to the same onMerge handler as the auto-merge effect", () => {
    // The auto-merge useEffect already calls onMerge when CI turns
    // green. The manual button must use the SAME handler — otherwise
    // a click would either no-op or take a different code path that
    // bypasses the parent mutation. Pinned here so a future rename of
    // the prop or handler in VibePage can't desync the two paths.
    const mergeBlock = SOURCE.match(/<MergeButton\b[\s\S]*?\/>/);
    expect(
      mergeBlock,
      "MergeButton element must be self-closed",
    ).not.toBeNull();
    expect(mergeBlock![0]).toMatch(/onMerge=\{onMerge\}/);
  });

  it("passes the PR number and branch info to the manual Merge button", () => {
    // MergeButton opens MergeApprovalDialog with these props — they
    // must come from the same `pr` object the auto-merge effect
    // reads, not be hard-coded.
    const mergeBlock = SOURCE.match(/<MergeButton\b[\s\S]*?\/>/);
    expect(mergeBlock).not.toBeNull();
    expect(mergeBlock![0]).toMatch(/prNumber=\{pr\.number\}/);
    expect(mergeBlock![0]).toMatch(/prTitle=\{pr\.title\}/);
    expect(mergeBlock![0]).toMatch(/branchName=\{pr\.head\.ref\}/);
    expect(mergeBlock![0]).toMatch(/isMerging=\{isMerging\}/);
  });

  it("preserves the disabled 'Approved' badge for the UI-approved state", () => {
    // The badge is the user's visual confirmation that the approval
    // went through. Removing it would be a UX regression even if the
    // manual merge button is added.
    expect(SOURCE).toMatch(/<span>\s*Approved\s*<\/span>/);
  });

  it("preserves the auto-merge effect so the manual button is a supplement, not a replacement", () => {
    // The auto-merge useEffect is what makes the original 'click
    // Approve and forget' flow work. Removing it would force the
    // user to wait for CI AND click again, which is a regression even
    // with the new manual button in place.
    expect(SOURCE).toMatch(/autoMergedRef/);
    expect(SOURCE).toMatch(/void\s+onMerge\(\)/);
  });
});
