import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const BUILDER_SOURCE = readFileSync(
  resolve(__dirname, "../../builder/src/builder.ts"),
  "utf8",
);

describe("preview builder base builds", () => {
  it("finishes base-image builds before creating a runtime preview machine", () => {
    const imageBuild = BUILDER_SOURCE.indexOf("await pushPreviewImage(");
    const staleCleanup = BUILDER_SOURCE.indexOf(
      "const stale = await listMachines(appName, flyToken);",
    );
    const baseExit = BUILDER_SOURCE.indexOf(
      "base image ready; no runtime preview machine needed",
    );
    const runtimeMachine = BUILDER_SOURCE.indexOf(
      "const machineId = await createPreviewMachine(",
    );

    expect(imageBuild).toBeGreaterThan(-1);
    expect(staleCleanup).toBeGreaterThan(imageBuild);
    expect(baseExit).toBeGreaterThan(staleCleanup);
    expect(baseExit).toBeLessThan(runtimeMachine);
  });
});
