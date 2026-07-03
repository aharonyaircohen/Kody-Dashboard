/**
 * @fileoverview Source-level guard for Brain terminal wake wait bounds.
 * @testFramework vitest
 * @domain terminal
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  resolve(__dirname, "../../app/api/kody/terminal/session/route.ts"),
  "utf8",
);

describe("terminal session wake wait", () => {
  it("waits long enough for Brain machines while keeping a hard route bound", () => {
    expect(SOURCE).toContain("export const maxDuration = 90;");
    expect(SOURCE).toContain("const WAKE_POLL_ATTEMPTS = 60;");
    expect(SOURCE).toContain("const WAKE_POLL_INTERVAL_MS = 1000;");
    expect(SOURCE).toContain("Brain machine did not become ready in time");
  });
});
