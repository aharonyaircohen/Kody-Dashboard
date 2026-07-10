/**
 * @fileoverview Kody is a regular editable agent: the built-in entry is only
 * a placeholder until agents/kody.md exists — the first edit creates the
 * file (create API), and a real file entry replaces the placeholder.
 * @testFramework vitest
 * @domain agents
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  join(process.cwd(), "src/dashboard/lib/components/AgentsControl.tsx"),
  "utf8",
);

describe("Kody agent editability", () => {
  it("no permanent read-only dead-end remains", () => {
    expect(SOURCE).not.toContain("Built-in · permanent");
    expect(SOURCE).not.toContain("never editable");
  });

  it("the placeholder offers Edit and the first save creates kody.md", () => {
    expect(SOURCE).toContain(
      "Edit — saves agents/kody.md, making Kody a regular agent",
    );
    expect(SOURCE).toContain("isFileless");
    expect(SOURCE).toMatch(/createMutation.mutate\(\s*\{ slug: member.slug/);
  });

  it("a real kody.md file wins over the built-in placeholder", () => {
    expect(SOURCE).toContain("fileKody ?? BUILTIN_KODY_AGENT");
  });
});
