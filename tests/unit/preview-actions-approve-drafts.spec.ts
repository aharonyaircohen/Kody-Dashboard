/**
 * Source-level structural test for the "Also approve drafts" toggle
 * in `PreviewActions.tsx` (issue #129). The Approve button used to
 * fail silently on draft PRs — `octokit.pulls.createReview({event:
 * "APPROVE"})` is rejected on drafts by GitHub. The fix:
 *
 *   1. Surface `pr.isDraft` (added to `GitHubPR` by the GraphQL query
 *      update in the same change set) so the UI can react.
 *   2. Add a checkbox (default on) in the action bar that, when on,
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

const SOURCE = readFileSync(PREVIEW_ACTIONS_PATH, "utf8");

describe("PreviewActions — 'Also approve drafts' toggle (issue #129)", () => {
  it("reads the PR's draft status (isDraft) so the toggle is wired to real data", () => {
    // The GraphQL fetch now exposes `isDraft` on `GitHubPR`. The component
    // must read it from `pr` so the badge + toggle default are correct.
    // Match either `pr.isDraft` (most natural) or an alias to the same.
    expect(SOURCE, "PR isDraft must be read off the `pr` object").toMatch(
      /\bpr\.isDraft\b/,
    );
  });

  it("declares state for the 'also approve drafts' toggle", () => {
    // useState for the checkbox's checked state — must default to `true`
    // so the existing 'click Approve and forget' flow keeps working on
    // draft PRs (the issue's default: ON contract).
    expect(SOURCE, "useState for the drafts toggle must exist").toMatch(
      /useState\s*\(\s*true\s*\)/,
    );
  });

  it("renders a Checkbox bound to the toggle (issue #129 acceptance criteria)", () => {
    // A Radix Checkbox is in the UI primitives and is the existing
    // pattern in this codebase (e.g. notification prefs).
    expect(SOURCE, "Checkbox primitive must be imported").toMatch(
      /import\s*\{[^}]*\bCheckbox\b[^}]*\}\s*from\s*["']@dashboard\/ui\/checkbox["']/,
    );
    expect(SOURCE, "Checkbox must be rendered as a JSX element").toMatch(
      /<Checkbox\b/,
    );
  });

  it("labels the toggle 'Also approve drafts'", () => {
    // The user-facing label has to match the issue's spec verbatim so the
    // acceptance test for the message in the error path is meaningful.
    expect(SOURCE).toMatch(/Also approve drafts/);
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

  it("forwards the draft + toggle state to MergeButton so the badge is consistent", () => {
    // The standalone Merge button must know the PR is a draft (or
    // has been marked ready by the new path) so its own visual state
    // stays in sync. The cheapest way to keep the wiring explicit is
    // to pass `prIsDraft` (or the toggle value) as a prop.
    const mergeBlock = SOURCE.match(/<MergeButton\b[\s\S]*?\/>/);
    expect(
      mergeBlock,
      "MergeButton element must still self-close",
    ).not.toBeNull();
    // Accept any one of the prop names that the fix might pick.
    expect(
      mergeBlock![0],
      "MergeButton must receive the draft/toggle prop",
    ).toMatch(/\b(prIsDraft|isDraft|approveDrafts)\s*=\s*\{/);
  });
});
