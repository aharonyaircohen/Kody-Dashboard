import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  join(process.cwd(), "src/dashboard/lib/components/KodyDashboard.tsx"),
  "utf8",
);

describe("stop task pending state", () => {
  it("does not optimistically move a stopping task back to the backlog", () => {
    const stopMutation = dashboardSource.match(
      /const stopMutation = useMutation\(\{[\s\S]*?\n  \}\);/,
    )?.[0];

    expect(stopMutation).toBeDefined();
    expect(stopMutation).not.toMatch(/column:\s*"open"/);
  });
});
