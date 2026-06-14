/**
 * Source-level structural test for the "Also approve drafts" toggle
 * in the merge approval flow (issue #129). The Approve button used to
 * fail silently on draft PRs — `octokit.pulls.createReview({event:
 * "APPROVE"})` is rejected on drafts by GitHub. The fix:
 *
 *   1. Surface `pr.isDraft` (added to `GitHubPR` by the GraphQL query
 *      update in the same change set) so the UI can react.
 *   2. Add a checkbox (default on) in the merge modal that, when on,
 *      asks the backend to mark the PR ready-for-review before
 *      posting the approval.
 *   3. Show a "draft" badge on the Approve button whenever the PR
 *      is in draft state.
 *   4. When the toggle is OFF and the user clicks Approve on a draft
 *      PR, show a clear error toast and bail (no silent no-op).
 *
 * Like `preview-actions-merge-button.spec.ts`, we use source-level
 * assertions (read the file as a string and grep for JSX markers)
 * so we don't need happy-dom / @testing-library/react — the component
 * is too hook-heavy for a node-environment vitest.
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
const MERGE_APPROVAL_DIALOG_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/MergeApprovalDialog.tsx",
);

const SOURCE = readFileSync(PREVIEW_ACTIONS_PATH, "utf8");
const DIALOG_SOURCE = readFileSync(MERGE_APPROVAL_DIALOG_PATH, "utf8");

describe("PreviewActions — 'Also approve drafts' toggle (issue #129)", () => {
  it("reads the PR's draft status (isDraft) so the toggle is wired to real data", () => {
    // The GraphQL fetch now exposes `isDraft` on `GitHubPR`. The component
    // must read it from `pr` so the badge + toggle default are correct.
    // Match either `pr.isDraft` (most natural) or an alias to the same.
    expect(SOURCE, "PR isDraft must be read off the `pr` object").toMatch(
      /\bpr\.isDraft\b/,
    );
  });

  it("does not render the toggle in the preview action bar", () => {
    expect(SOURCE, "PreviewActions must not import the checkbox").not.toMatch(
      /import\s*\{[^}]*\bCheckbox\b[^}]*\}\s*from\s*["']@dashboard\/ui\/checkbox["']/,
    );
    expect(SOURCE, "PreviewActions must not render the checkbox").not.toMatch(
      /<Checkbox\b/,
    );
  });

  it("declares state for the modal's 'also approve drafts' toggle", () => {
    // useState for the checkbox's checked state — must default to `true`
    // so the existing 'click Approve and forget' flow keeps working on
    // draft PRs (the issue's default: ON contract).
    expect(DIALOG_SOURCE, "useState for the drafts toggle must exist").toMatch(
      /useState\s*\(\s*true\s*\)/,
    );
  });

  it("renders a Checkbox in the merge modal", () => {
    // A Radix Checkbox is in the UI primitives and is the existing
    // pattern in this codebase (e.g. notification prefs).
    expect(DIALOG_SOURCE, "Checkbox primitive must be imported").toMatch(
      /import\s*\{[^}]*\bCheckbox\b[^}]*\}\s*from\s*["']@dashboard\/ui\/checkbox["']/,
    );
    expect(DIALOG_SOURCE, "Checkbox must be rendered as a JSX element").toMatch(
      /<Checkbox\b/,
    );
  });

  it("labels the modal toggle 'Also approve drafts'", () => {
    expect(DIALOG_SOURCE).toMatch(/Also approve drafts/);
  });

  it("opens the merge modal from the Approve button", () => {
    expect(SOURCE).toMatch(/setShowMergeDialog\(true\)/);
    expect(SOURCE).toMatch(/<MergeApprovalDialog\b/);
    expect(SOURCE).toMatch(/onApprove=\{handleApprove\}/);
  });

  it("only shows the modal toggle when the PR is a draft", () => {
    expect(DIALOG_SOURCE).toMatch(/isApprovalFlow\s*&&\s*prIsDraft\s*&&\s*\(/);
  });

  it("shows a 'draft' badge on the Approve button when the PR is in draft state", () => {
    // The badge is the visual cue that the toggle matters. Match a small
    // chunk of conditional JSX so a future refactor can't silently drop
    // the gate.
    const badgeBlock = SOURCE.match(
      /\{[^}]*pr\.isDraft[^}]*\}[\s\S]{0,200}?draft[\s\S]{0,80}?\}?/i,
    );
    expect(
      badgeBlock,
      "A conditional 'draft' badge on the Approve button is required",
    ).not.toBeNull();
  });

  it("passes `approveDrafts` to tasksApi.approvePR so the backend can mark the PR ready", () => {
    // The handleApprove call must forward the toggle so the server-side
    // approve-pr case can flip `draft:false` before createReview. We
    // allow either a named-arg call (`approveDrafts: ...`) or a literal
    // — what we MUST see is the new key.
    expect(
      SOURCE,
      "handleApprove must pass `approveDrafts` to approvePR",
    ).toMatch(
      /approvePR\(\s*task\.issueNumber\s*,\s*[^,]+,\s*\{[\s\S]*?approveDrafts/,
    );
  });

  it("hard-blocks Approve with a clear error when the toggle is OFF and the PR is a draft", () => {
    // The acceptance criterion: "with the toggle OFF, Approve shows a
    // clear error: 'This PR is a draft — turn on \"Also approve drafts\"
    // to continue.'" Match the user-visible error string verbatim.
    expect(
      SOURCE,
      "Error toast must mention 'Also approve drafts' so the user knows the fix",
    ).toMatch(/This PR is a draft[\s\S]{0,80}Also approve drafts/i);
  });

  it("forwards the draft state to the merge modal", () => {
    const mergeBlock = SOURCE.match(/<MergeApprovalDialog\b[\s\S]*?\/>/);
    expect(
      mergeBlock,
      "MergeApprovalDialog element must still self-close",
    ).not.toBeNull();
    expect(
      mergeBlock![0],
      "MergeApprovalDialog must receive the draft prop",
    ).toMatch(/\bprIsDraft=\{pr\.isDraft\s*\?\?\s*false\}/);
  });
});
