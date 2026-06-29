/**
 * @fileoverview Source-level guard for Brain image save route wiring.
 * @testFramework vitest
 * @domain brain
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SOURCE = readFileSync(
  resolve(__dirname, "../../app/api/kody/brain/image/route.ts"),
  "utf8",
);
const BRIDGE_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/terminal/bridge-fly.ts"),
  "utf8",
);
const PROVISION_SOURCES = [
  "../../app/api/kody/brain/provision/route.ts",
  "../../app/api/kody/brain/login/route.ts",
  "../../app/api/kody/chat/brain-fly/route.ts",
].map((file) => readFileSync(resolve(__dirname, file), "utf8"));

describe("Brain image save route", () => {
  it("exports Brain state through the terminal bridge and records a GHCR image ref", () => {
    expect(ROUTE_SOURCE).toContain("/api/kody/brain/image");
    expect(ROUTE_SOURCE).toContain("ensureTerminalBridge");
    expect(ROUTE_SOURCE).toContain("/exec");
    expect(ROUTE_SOURCE).toContain("brainImageBuildCommand");
    expect(ROUTE_SOURCE).toContain("brainFlyImageRef");
    expect(ROUTE_SOURCE).toContain("resolveBrainService");
    expect(ROUTE_SOURCE).toContain("machineIdOverride");
    expect(ROUTE_SOURCE).toContain("local: true");
    expect(ROUTE_SOURCE).toContain("readBrainImage");
    expect(ROUTE_SOURCE).toContain("writeBrainImage");
    expect(ROUTE_SOURCE).not.toContain("brain_app_mismatch");
  });

  it("supports authenticated non-interactive bridge commands", () => {
    expect(BRIDGE_SOURCE).toContain('url.pathname === "/exec"');
    expect(BRIDGE_SOURCE).toContain("runOneShotFlyCommand");
    expect(BRIDGE_SOURCE).toContain("runOneShotLocalCommand");
    expect(BRIDGE_SOURCE).toContain("body.local === true");
    expect(BRIDGE_SOURCE).toContain('"--command"');
    expect(BRIDGE_SOURCE).toContain("MAX_EXEC_OUTPUT_BYTES");
  });

  it("reuses the saved image ref on all Brain provision paths", () => {
    for (const source of PROVISION_SOURCES) {
      expect(source).toContain("readBrainImage");
      expect(source).toContain("imageRef: image.imageRef");
    }
  });
});
