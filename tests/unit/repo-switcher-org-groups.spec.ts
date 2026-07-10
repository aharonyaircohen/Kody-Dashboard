/**
 * Source-level structural tests for RepoSwitcher org grouping.
 *
 * The component is hook/browser-state heavy and the repo does not use
 * happy-dom for component rendering tests, so this follows the existing
 * source assertion pattern used by chat/report UI tests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_SWITCHER_PATH = resolve(
  __dirname,
  "../../node_modules/@kody-ade/kody-chat/src/dashboard/lib/components/RepoSwitcher.tsx",
);
const SOURCE = readFileSync(REPO_SWITCHER_PATH, "utf8");

describe("RepoSwitcher org grouping", () => {
  it("groups connected repositories by owner", () => {
    expect(SOURCE).toMatch(/groupReposByOwner/);
    expect(SOURCE).toMatch(/repoGroups\.map/);
    expect(SOURCE).toMatch(/group\.owner/);
  });

  it("links each owner group to its org manager", () => {
    expect(SOURCE).toMatch(/Manage org/);
    expect(SOURCE).toMatch(
      /href=\{`\/org\/\$\{encodeURIComponent\(group\.owner\)\}`\}/,
    );
  });

  it("switches repositories to the matching repo-scoped route", () => {
    expect(SOURCE).toContain("repoSwitchRedirectPath");
    expect(SOURCE).toContain("redirectTo: repoSwitchRedirectPath(");
    expect(SOURCE).toContain("window.location.pathname");
    expect(SOURCE).toContain("window.location.search");
    expect(SOURCE).toContain("window.location.hash");
    expect(SOURCE).toContain("navigateBeforeCommit: true");
  });
});
