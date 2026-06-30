import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) =>
  readFileSync(
    join(process.cwd(), "src/dashboard/lib/components", file),
    "utf8",
  );

describe("repo-scoped navigation surfaces", () => {
  it("scopes desktop sidebar links and mode jumps through the route model", () => {
    const sidebar = source("Sidebar.tsx");
    expect(sidebar).toContain("repoScopedHref");
    expect(sidebar).toContain("scopedHref(item.href)");
    expect(sidebar).toContain('scopedHref("/")');
    expect(sidebar).toContain(
      'scopedHref(next === "vibe" ? "/vibe" : "/tasks")',
    );
  });

  it("scopes mobile menu links through the route model", () => {
    const mobileMenu = source("MobileMenu.tsx");
    expect(mobileMenu).toContain("repoScopedHref");
    expect(mobileMenu).toContain("scopedHref(item.href)");
  });

  it("scopes command palette navigation through the route model", () => {
    const commandPalette = source("CommandPalette.tsx");
    expect(commandPalette).toContain("repoScopedHref");
    expect(commandPalette).toContain("repoPathForNavMatching");
    expect(commandPalette).toContain("router.push(scopedHref(href))");
  });

  it("scopes chat rail expansion under repo routes", () => {
    const chatRailShell = source("ChatRailShell.tsx");
    expect(chatRailShell).toContain("repoPathForNavMatching");
    expect(chatRailShell).toContain(
      'const isChatRoute = currentRepoPath === "/chat"',
    );
    expect(chatRailShell).toContain("routeOwnsAppHeader(currentRepoPath)");
    expect(chatRailShell).not.toContain('pathname === "/chat"');
    expect(chatRailShell).not.toContain("routeOwnsAppHeader(pathname)");
    expect(chatRailShell).toContain('router.push(scopedHref("/chat"))');
    expect(chatRailShell).toContain('scopedHref("/tasks")');
  });
});
