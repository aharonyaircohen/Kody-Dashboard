import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/dashboard/lib/hooks/useScrollRestoration.ts"),
  "utf8",
);

describe("scroll restoration", () => {
  it("restores the saved scroll position immediately and across layout frames", () => {
    const savedIndex = SOURCE.indexOf(
      "const saved = scrollStore.get(keyRef.current) ?? 0;",
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
});
