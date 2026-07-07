/**
 * @fileoverview Source-level guard for terminal bridge async job output.
 * @testFramework vitest
 * @domain terminal
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/terminal/bridge-fly.ts"),
  "utf8",
);

describe("terminal bridge async jobs", () => {
  it("stores stdout and stderr while the job is still running", () => {
    expect(SOURCE).toContain("onStdout");
    expect(SOURCE).toContain("job.stdout += chunk.toString");
    expect(SOURCE).toContain("onStderr");
    expect(SOURCE).toContain("job.stderr += chunk.toString");
  });
});
