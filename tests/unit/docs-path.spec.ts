import { describe, expect, it } from "vitest";
import { isAllowedDocPath } from "@dashboard/lib/docs/file";

describe("docs path guard", () => {
  it("allows only README and docs markdown files", () => {
    expect(isAllowedDocPath("README.md")).toBe(true);
    expect(isAllowedDocPath("docs/guide.md")).toBe(true);

    expect(isAllowedDocPath(".env")).toBe(false);
    expect(isAllowedDocPath("docs/../.env")).toBe(false);
    expect(isAllowedDocPath("/etc/passwd")).toBe(false);
    expect(isAllowedDocPath("src/app.ts")).toBe(false);
    expect(isAllowedDocPath("docs/nested/guide.md")).toBe(false);
  });
});
