import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(
  join(process.cwd(), "src/dashboard/lib/components/ChatRailShell.tsx"),
  "utf8",
);
const authSource = readFileSync(
  join(process.cwd(), "src/dashboard/lib/auth-context.tsx"),
  "utf8",
);

describe("repo route auth sync wiring (URL-first)", () => {
  it("auth context derives the active repo from the pathname", () => {
    expect(authSource).toContain("usePathname");
    expect(authSource).toContain("resolveActiveRepo(storedAuth, pathname)");
  });

  it("shell no longer runs a switch effect — only the missing state remains", () => {
    expect(shellSource).toContain("resolveRepoRouteAuthSync");
    expect(shellSource).not.toContain('status === "switch"');
    expect(shellSource).toContain('status === "missing"');
  });

  it("repo switching is a full-page navigation to the repo's own URL", () => {
    expect(authSource).toContain("redirectTo?: string");
    expect(authSource).toContain(
      "window.location.assign(options?.redirectTo ?? repoBasePath(cur))",
    );
  });
});
