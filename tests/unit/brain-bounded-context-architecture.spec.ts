/**
 * @fileoverview Source guards for the Brain bounded context command/query shape.
 * @testFramework vitest
 * @domain brain
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function exists(path: string): boolean {
  return existsSync(resolve(root, path));
}

describe("Brain bounded context architecture", () => {
  it("exposes command/query use cases for the Brain product", () => {
    for (const path of [
      "src/dashboard/lib/brain/overview.ts",
      "src/dashboard/lib/brain/server-commands.ts",
      "src/dashboard/lib/brain/image-save-command.ts",
      "src/dashboard/lib/brain/image-apply-command.ts",
      "src/dashboard/lib/brain/terminal-connect.ts",
    ]) {
      expect(exists(path), path).toBe(true);
      expect(source(path), path).toContain("@fileType use-case");
    }
  });

  it("keeps Brain API routes as use-case wrappers", () => {
    expect(source("app/api/kody/brain/status/route.ts")).toContain(
      "readBrainOverview(",
    );
    expect(source("app/api/kody/brain/provision/route.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("app/api/kody/brain/login/route.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("app/api/kody/chat/brain-fly/route.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("app/api/kody/brain/resume/route.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("app/api/kody/brain/suspend/route.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("app/api/kody/brain/destroy/route.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("app/api/kody/brain/suspension/route.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("app/api/kody/brain/image/apply/route.ts")).toContain(
      "applyBrainImage(",
    );
    expect(source("app/api/kody/terminal/session/route.ts")).toContain(
      "connectBrainTerminal(",
    );
  });
});
