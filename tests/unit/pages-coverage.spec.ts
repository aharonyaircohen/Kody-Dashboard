/**
 * @fileoverview Every canonical shared page shipped by @kody-ade/kody-chat
 * (pages/*) must be served by this app via a route file that re-exports it.
 * Adding a page to the package without registering a dash route fails here
 * with the missing path.
 * @testFramework vitest
 * @domain pages
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Canonical page module -> this app's route file. */
const ROUTE_FOR: Record<string, string> = {
  models: "app/(chat-rail)/models/page.tsx",
  secrets: "app/(chat-rail)/secrets/page.tsx",
  settings: "app/(chat-rail)/settings/page.tsx",
  brands: "app/(chat-rail)/brands/page.tsx",
  "brand-detail": "app/(chat-rail)/brands/[slug]/page.tsx",
  commands: "app/(chat-rail)/commands/page.tsx",
  context: "app/(chat-rail)/context/page.tsx",
  "context-detail": "app/(chat-rail)/context/[slug]/page.tsx",
  memory: "app/(chat-rail)/memory/page.tsx",
  "memory-detail": "app/(chat-rail)/memory/[id]/page.tsx",
  instructions: "app/(chat-rail)/instructions/page.tsx",
};

const PAGES_DIR = join(
  process.cwd(),
  "node_modules/@kody-ade/kody-chat/src/dashboard/lib/pages",
);

describe("shared pages route coverage", () => {
  const pages = readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\.tsx$/, ""));

  it("every canonical package page has a dash route mapping", () => {
    for (const page of pages) {
      expect(ROUTE_FOR[page], `add a dash route mapping for pages/${page}`).toBeTruthy();
    }
  });

  it("every route file exists and re-exports its canonical page", () => {
    for (const [page, route] of Object.entries(ROUTE_FOR)) {
      const abs = join(process.cwd(), route);
      expect(existsSync(abs), `${route} is missing`).toBe(true);
      expect(
        readFileSync(abs, "utf8"),
        `${route} must re-export @kody-ade/kody-chat/pages/${page}`,
      ).toContain(`@kody-ade/kody-chat/pages/${page}"`);
    }
  });
});
