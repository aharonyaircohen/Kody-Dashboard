import { describe, expect, it } from "vitest";

import {
  DEFAULT_FLY_PREVIEWS,
  resolveFlyPreviews,
} from "@dashboard/lib/engine/config";

describe("Fly preview config", () => {
  it("defaults to a suspend-eligible preview size", () => {
    expect(DEFAULT_FLY_PREVIEWS.memoryMb).toBe(2048);
    expect(DEFAULT_FLY_PREVIEWS.builderCpus).toBe(4);
    expect(DEFAULT_FLY_PREVIEWS.builderMemoryMb).toBe(4096);
    expect(resolveFlyPreviews({ executables: { default: "run" } })).toEqual(
      expect.objectContaining({
        memoryMb: 2048,
        idleSuspend: true,
        builderCpus: 4,
        builderMemoryMb: 4096,
      }),
    );
  });

  it("keeps explicit larger preview sizes as an override", () => {
    expect(
      resolveFlyPreviews({
        executables: { default: "run" },
        fly: { previews: { memoryMb: 4096 } },
      }),
    ).toEqual(expect.objectContaining({ memoryMb: 4096 }));
  });

  it("keeps explicit builder size as an override", () => {
    expect(
      resolveFlyPreviews({
        executables: { default: "run" },
        fly: { previews: { builderCpus: 8, builderMemoryMb: 8192 } },
      }),
    ).toEqual(
      expect.objectContaining({ builderCpus: 8, builderMemoryMb: 8192 }),
    );
  });
});
