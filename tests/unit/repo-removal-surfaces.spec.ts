/**
 * Source-level structural tests for repository removal entry points.
 *
 * These components depend on browser auth state and Radix overlays, while the
 * repo intentionally does not carry a DOM testing setup. This follows the
 * existing source assertion pattern for hook-heavy UI components.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readComponent(name: string): string {
  return readFileSync(
    resolve(__dirname, `../../src/dashboard/lib/components/${name}.tsx`),
    "utf8",
  );
}

const REPO_SWITCHER = readFileSync(
  resolve(
    __dirname,
    "../../node_modules/@kody-ade/kody-chat/src/dashboard/lib/components/RepoSwitcher.tsx",
  ),
  "utf8",
);
const MOBILE_MENU = readFileSync(
  resolve(
    __dirname,
    "../../node_modules/@kody-ade/kody-chat/src/dashboard/lib/components/MobileMenu.tsx",
  ),
  "utf8",
);
const ORG_MANAGER = readComponent("OrgManager");

describe("repository removal surfaces", () => {
  it("keeps the header repository remove button visible on touch screens", () => {
    const removeButtonClass = REPO_SWITCHER.match(
      /aria-label=\{`Remove \$\{entry\.owner\}\/\$\{entry\.repo\}`\}[\s\S]*?className="([^"]+)"/,
    )?.[1];

    expect(removeButtonClass).toContain(
      "md:opacity-0 md:group-hover:opacity-100",
    );
    expect(removeButtonClass).not.toContain(
      "opacity-0 group-hover:opacity-100",
    );
  });

  it("exposes current repository removal in the mobile menu", () => {
    expect(MOBILE_MENU).toMatch(/Remove current repo/);
    expect(MOBILE_MENU).toMatch(/setConfirmRemove\(\{/);
    expect(MOBILE_MENU).toMatch(/removeRepo\(confirmRemove\.index\)/);
  });

  it("exposes repository removal on the org page attached repository rows", () => {
    expect(ORG_MANAGER).toMatch(/setConfirmRemove\(\{ index, entry: repo \}\)/);
    expect(ORG_MANAGER).toMatch(/Login repo can't be removed/);
    expect(ORG_MANAGER).toMatch(/removeRepo\(confirmRemove\.index\)/);
  });
});
