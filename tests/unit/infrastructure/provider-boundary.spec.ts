import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("infrastructure provider boundary", () => {
  it("keeps the generic registry free of vendor plugin imports", () => {
    const registry = readRepoFile("src/dashboard/lib/infrastructure/registry.ts");

    expect(registry).not.toContain("/plugins/fly");
    expect(registry).not.toContain("flyInfrastructure");
  });

  it("keeps migrated runtime callers from selecting Fly directly", () => {
    const migratedCallers = [
      "app/api/kody/chat/interactive/start/route.ts",
      "app/api/kody/chat/interactive/start-fly/route.ts",
      "app/api/kody/vibe/execute/route.ts",
      "src/dashboard/lib/runners/kody-runner.ts",
      "src/dashboard/lib/runners/runner-dispatch.ts",
      "src/dashboard/lib/runners/runner-router.ts",
      "src/dashboard/lib/runners/server-run.ts",
      "src/dashboard/lib/previews/preview-lifecycle.ts",
    ];

    for (const file of migratedCallers) {
      const source = readRepoFile(file);
      expect(source).not.toContain('getServerProvider("fly"');
      expect(source).not.toContain('getDeploymentProvider("fly"');
      expect(source).not.toContain("flyComputeProvider");
      expect(source).not.toContain("resolveFlyContext");
      expect(source).not.toContain("claimOrSpawnFly");
      expect(source).not.toContain("flyAvailable");
      expect(source).not.toContain("runFly");
      expect(source).not.toContain("flyResult");
      expect(source).not.toContain("@dashboard/lib/infrastructure/plugins/fly");
      expect(source).not.toContain("@dashboard/lib/infrastructure/providers/fly");
    }
  });

  it("keeps Fly provider code inside the plugin directory", () => {
    const installed = readRepoFile("src/dashboard/lib/infrastructure/installed.ts");

    expect(installed).toContain("@dashboard/lib/infrastructure/plugins/fly");
    expect(() =>
      readRepoFile("src/dashboard/lib/infrastructure/providers/fly/compute.ts"),
    ).toThrow();
  });
});
