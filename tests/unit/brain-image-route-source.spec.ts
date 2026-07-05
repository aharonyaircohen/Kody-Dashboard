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
const BRIDGE_EXEC_CLIENT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/terminal/bridge-exec-client.ts"),
  "utf8",
);
const PROVISION_SOURCES = [
  "../../app/api/kody/brain/provision/route.ts",
  "../../app/api/kody/brain/login/route.ts",
  "../../app/api/kody/chat/brain-fly/route.ts",
].map((file) => readFileSync(resolve(__dirname, file), "utf8"));
const APPLY_ROUTE_SOURCE = readFileSync(
  resolve(__dirname, "../../app/api/kody/brain/image/apply/route.ts"),
  "utf8",
);
const APPLY_SERVICE_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/brain/image-apply.ts"),
  "utf8",
);

describe("Brain image save route", () => {
  it("exports Brain state through the terminal bridge and records a GHCR image ref", () => {
    expect(ROUTE_SOURCE).toContain("/api/kody/brain/image");
    expect(ROUTE_SOURCE).toContain("ensureTerminalBridge");
    expect(ROUTE_SOURCE).toContain("startTerminalBridgeLocalExecJob");
    expect(ROUTE_SOURCE).toContain("getTerminalBridgeExecJob");
    expect(BRIDGE_EXEC_CLIENT_SOURCE).toContain("/exec");
    expect(BRIDGE_EXEC_CLIENT_SOURCE).toContain("/jobs");
    expect(ROUTE_SOURCE).toContain("brainImageBuildCommand");
    expect(ROUTE_SOURCE).toContain("brainGhcrImageRef");
    expect(ROUTE_SOURCE).toContain("brainGhcrAuth");
    expect(ROUTE_SOURCE).toContain("ghcrToken: ghcr.token");
    expect(ROUTE_SOURCE).toContain("writeBrainImageSave");
    expect(ROUTE_SOURCE).toContain("readBrainImageSave");
    expect(ROUTE_SOURCE).toContain("clearBrainImageSave");
    expect(ROUTE_SOURCE).toContain("export async function GET");
    expect(ROUTE_SOURCE).toContain("resolveBrainService");
    expect(ROUTE_SOURCE).not.toContain("machineIdOverride");
    expect(ROUTE_SOURCE).not.toContain("appNameOverride: parsed.data.app");
    expect(ROUTE_SOURCE).toContain(
      "brainImageBuildCommand({\n        app,\n        machineId,\n        orgSlug: brain.orgSlug,",
    );
    expect(BRIDGE_EXEC_CLIENT_SOURCE).toContain("local: true");
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
    expect(BRIDGE_SOURCE).toContain("GHCR_TOKEN: claims.ghcrToken ||");
    expect(BRIDGE_SOURCE).toContain("EXEC_KEEPALIVE_INTERVAL_MS");
    expect(BRIDGE_SOURCE).toContain('res.write(" ")');
    expect(BRIDGE_SOURCE).toContain("memory_mb: 2048");
    expect(BRIDGE_SOURCE).toContain("REQUEST_TIMEOUT_MS = 90_000");
  });

  it("keeps image apply explicit and out of normal Brain provision paths", () => {
    for (const source of PROVISION_SOURCES) {
      expect(source).toContain("resolveBrainTarget");
      expect(source).not.toContain("readBrainImage");
      expect(source).not.toContain("prepareBrainRuntimeImage");
      expect(source).not.toContain("resolveRuntimeImageRef");
      expect(source).not.toContain("prepareRuntimeImage");
    }
    expect(APPLY_ROUTE_SOURCE).toContain("applySelectedBrainImage");
    expect(APPLY_ROUTE_SOURCE).toContain("const body =");
    expect(APPLY_ROUTE_SOURCE).toContain("imageRef: body.imageRef");
    expect(APPLY_SERVICE_SOURCE).toContain("readBrainImage");
    expect(APPLY_SERVICE_SOURCE).toContain(
      "input.imageRef ?? runtimeView.desiredImageRef ?? image?.imageRef",
    );
    expect(APPLY_SERVICE_SOURCE).toContain("imageRef,");
    expect(APPLY_SERVICE_SOURCE).toContain("prepareBrainRuntimeImage");
    expect(APPLY_SERVICE_SOURCE).toContain("resolveRuntimeImageRef");
    expect(APPLY_SERVICE_SOURCE).toContain("beginBrainRuntimeApply");
    expect(APPLY_SERVICE_SOURCE).toContain("completeBrainRuntimeApply");
    expect(APPLY_SERVICE_SOURCE).toContain("brainImageCatalogFile");
    expect(APPLY_SERVICE_SOURCE).not.toContain("selectBrainImage");
    expect(APPLY_SERVICE_SOURCE).not.toContain("markBrainImageRunning");
  });
});
