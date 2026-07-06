/**
 * @fileoverview Regression guards for Brain Fly routes that touch repo state.
 * @testFramework vitest
 * @domain brain
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function readRoute(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const STATEFUL_ROUTES = [
  "app/api/kody/brain/provision/route.ts",
  "app/api/kody/brain/login/route.ts",
  "app/api/kody/brain/status/route.ts",
  "app/api/kody/brain/destroy/route.ts",
  "app/api/kody/brain/stored/route.ts",
  "app/api/kody/brain/suspend/route.ts",
  "app/api/kody/brain/resume/route.ts",
  "app/api/kody/chat/brain-fly/route.ts",
];

describe("Brain Fly route GitHub context", () => {
  it("sets and clears request GitHub context around state-backed Brain work", () => {
    for (const routePath of STATEFUL_ROUTES) {
      const source = readRoute(routePath);
      expect(source, routePath).toContain("setGitHubContext(");
      expect(source, routePath).toContain("clearGitHubContext()");
      expect(source, routePath).toContain("ctx.context.storeRepoUrl");
      expect(source, routePath).toContain("ctx.context.storeRef");
    }
  });

  it("uses the resolved Brain service for every machine control route", () => {
    const commandSource = readRoute("src/dashboard/lib/brain/server-commands.ts");
    expect(commandSource).toContain("resolveBrainService(");
    expect(commandSource).toContain("appNameOverride: brain.app");
    for (const routePath of [
      "app/api/kody/brain/destroy/route.ts",
      "app/api/kody/brain/suspend/route.ts",
      "app/api/kody/brain/resume/route.ts",
    ]) {
      const source = readRoute(routePath);
      expect(source, routePath).toContain("manageBrainServer(");
    }
  });
});
