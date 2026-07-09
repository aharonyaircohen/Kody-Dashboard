import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/dashboard/lib/hooks/useScrollRestoration.ts"),
  "utf8",
);
const DASHBOARD_SOURCE = readFileSync(
  resolve(process.cwd(), "src/dashboard/lib/components/KodyDashboard.tsx"),
  "utf8",
);

describe("scroll restoration", () => {
  it("restores the saved scroll position immediately and across layout frames", () => {
    const savedIndex = SOURCE.indexOf(
      "const saved = scrollStore.get(restoreKey) ?? 0;",
    );
    const immediateIndex = SOURCE.indexOf(
      "node.scrollTop = saved;",
      savedIndex,
    );
    const rafIndex = SOURCE.indexOf("requestAnimationFrame", immediateIndex);

    expect(savedIndex).toBeGreaterThan(-1);
    expect(immediateIndex).toBeGreaterThan(savedIndex);
    expect(rafIndex).toBeGreaterThan(immediateIndex);
    expect(SOURCE.match(/node\.scrollTop = saved;/g)?.length).toBeGreaterThan(
      1,
    );
  });

  it("restores again when the caller key changes without remounting", () => {
    expect(SOURCE).toContain("useLayoutEffect");
    expect(SOURCE).toContain(
      "const nodeRef = useRef<HTMLElement | null>(null)",
    );
    expect(SOURCE).toContain("restoreScroll(nodeRef.current, key)");
    expect(SOURCE).toContain("}, [key, restoreScroll]);");
  });

  it("keys the dashboard task list by API page and filters", () => {
    expect(DASHBOARD_SOURCE).toContain("const taskListScrollKey =");
    expect(DASHBOARD_SOURCE).toContain("page-${currentTaskPage}");
    expect(DASHBOARD_SOURCE).toContain(
      "const listScrollRef = useScrollRestoration(taskListScrollKey);",
    );
  });
});
