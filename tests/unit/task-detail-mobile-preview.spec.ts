/**
 * Regression test for issue #150: Preview pane doesn't appear on mobile
 * for completed tasks.
 *
 * The bug: the mobile preview button in `TaskDetail.tsx` (and the
 * desktop quickLinks header chip with the same gate) was rendered only
 * when the task's column was `review` or `done`. A "completed" task in
 * any other column (e.g. `building` with a finished pipeline run, or a
 * task whose preview was built during a previous run that's now in
 * `failed` / `retrying` / `gate-waiting`) has an associated PR — and
 * therefore an openable preview — but the button was hidden. On mobile
 * (< md) the right-side preview pane is also hidden, so the user had
 * no way to reach the preview at all.
 *
 * The fix: gate the preview button on `task.associatedPR && onOpenPreview`
 * alone. Having a PR is the necessary and sufficient signal that a
 * preview is potentially available — the column tells us the task
 * lifecycle, not whether a preview URL can be resolved.
 *
 * Source-level assertions mirror the pattern in
 * `preview-actions-merge-button.spec.ts` and
 * `preview-modal-positioning.spec.ts` — the component is too hook-heavy
 * to render under node-environment vitest, so we read the file and
 * check the JSX structure directly.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASK_DETAIL_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/TaskDetail.tsx",
);

const SOURCE = readFileSync(TASK_DETAIL_PATH, "utf8");

describe("TaskDetail — mobile preview button (issue #150)", () => {
  it("renders the desktop quickLinks Preview chip whenever the task has a PR", () => {
    // The bug: the chip was gated on `task.column === "review" || task.column === "done"`.
    // For a completed task in any other column the chip was missing.
    // Match the conditional render block and assert it does NOT require
    // the column to be review/done.
    const desktopChip = SOURCE.match(
      /\{[\s\S]{0,200}?task\.associatedPR[\s\S]{0,200}?onOpenPreview[\s\S]{0,400}?Preview[\s\S]{0,80}?<\/button>\s*\)\s*\}/,
    );
    expect(
      desktopChip,
      "There must be at least one Preview button guarded by `task.associatedPR && onOpenPreview`",
    ).not.toBeNull();
    // The OLD gate — must be gone.
    expect(
      desktopChip![0],
      'Desktop Preview chip must NOT require `task.column === "review" || task.column === "done"` — the gate must be dropped so completed tasks in other columns can also see the chip',
    ).not.toMatch(/task\.column\s*===\s*["']review["']/);
    expect(
      desktopChip![0],
      'Desktop Preview chip must NOT require `task.column === "done"` either',
    ).not.toMatch(/task\.column\s*===\s*["']done["']/);
  });

  it("renders the mobile bottom-toolbar Preview button whenever the task has a PR", () => {
    // The mobile bottom toolbar is the user's only path to the preview
    // on a phone (the right-side preview pane is hidden below md), so
    // the gate must be at least as permissive as the desktop one.
    // Locate the mobile bottom toolbar Preview button by its distinct
    // tailwind classes (rounded-full pill, h-9) and assert the gate.
    const mobileButtonBlock = SOURCE.match(
      /\{[\s\S]{0,200}?task\.associatedPR[\s\S]{0,200}?onOpenPreview[\s\S]{0,400}?rounded-full[\s\S]{0,200}?Preview[\s\S]{0,80}?<\/button>\s*\)\s*\}/,
    );
    expect(
      mobileButtonBlock,
      "There must be a Preview button in the mobile bottom toolbar guarded by `task.associatedPR && onOpenPreview` and styled with `rounded-full` (the mobile pill)",
    ).not.toBeNull();
    expect(
      mobileButtonBlock![0],
      'Mobile Preview button must NOT require `task.column === "review"` — the gate must be dropped so completed tasks in other columns can also see the button on mobile',
    ).not.toMatch(/task\.column\s*===\s*["']review["']/);
    expect(
      mobileButtonBlock![0],
      'Mobile Preview button must NOT require `task.column === "done"` either',
    ).not.toMatch(/task\.column\s*===\s*["']done["']/);
  });

  it("keeps the existing pre-conditions on the Preview button (onOpenPreview handler + associatedPR)", () => {
    // The fix must NOT weaken the handler/handler-availability gate —
    // the button still needs an onOpenPreview callback from the host
    // AND the task needs a PR. This is a regression guard against
    // accidentally stripping the necessary conditions when dropping the
    // column gate.
    const allBlocks =
      SOURCE.match(
        /\{[\s\S]{0,80}?task\.associatedPR[\s\S]{0,200}?onOpenPreview[\s\S]{0,400}?Preview[\s\S]{0,80}?<\/button>\s*\)\s*\}/g,
      ) ?? [];
    expect(
      allBlocks.length,
      "There must be at least one Preview button block guarded by `task.associatedPR && onOpenPreview`",
    ).toBeGreaterThan(0);
    for (const block of allBlocks) {
      expect(
        block,
        "Preview button block must still require `task.associatedPR`",
      ).toMatch(/task\.associatedPR/);
      expect(
        block,
        "Preview button block must still require `onOpenPreview`",
      ).toMatch(/onOpenPreview/);
      expect(block, "Preview button must still call `onOpenPreview()`").toMatch(
        /onOpenPreview\(\)/,
      );
    }
  });
});
