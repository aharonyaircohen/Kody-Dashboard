import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBrainPackageImageDiscoveryCache,
  discoverBrainPackageImages,
} from "../src/dashboard/lib/brain/image-catalog";

describe("Brain image catalog discovery cache", () => {
  afterEach(() => {
    clearBrainPackageImageDiscoveryCache();
    vi.restoreAllMocks();
  });

  it("reuses GHCR package discovery for repeated polls", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            created_at: "2026-07-07T00:00:00.000Z",
            updated_at: "2026-07-07T00:01:00.000Z",
            metadata: { container: { tags: ["saved"] } },
          },
        ],
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      owner: "owner",
      repo: "repo",
      account: "acc",
      githubToken: "token",
    };
    const first = await discoverBrainPackageImages(input);
    const second = await discoverBrainPackageImages(input);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
