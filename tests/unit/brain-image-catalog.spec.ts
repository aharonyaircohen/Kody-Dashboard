/**
 * @fileoverview Unit coverage for Brain image catalog file shaping.
 * @testFramework vitest
 * @domain brain
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  brainImageCatalogFile,
  upsertBrainCatalogImageFile,
} from "../../src/dashboard/lib/brain/image-catalog";

describe("Brain image catalog", () => {
  it("builds catalog-only image files without selected or running state", () => {
    const file = brainImageCatalogFile({
      previous: {
        version: 1,
        imageRef: "ghcr.io/acme/kody-brain-octocat:old",
        runningImageRef: "ghcr.io/acme/kody-brain-octocat:old",
        runningApp: "brain-1",
        runningMachineId: "machine-1",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        images: [],
      },
      images: [
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:new",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(file).not.toHaveProperty("imageRef");
    expect(file).not.toHaveProperty("runningImageRef");
    expect(file).not.toHaveProperty("runningApp");
    expect(file).not.toHaveProperty("runningMachineId");
    expect(file.images).toHaveLength(1);
  });

  it("upserts a saved image and removes it from forgotten refs", () => {
    const file = upsertBrainCatalogImageFile(
      {
        version: 1,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        forgottenImageRefs: [
          "ghcr.io/acme/kody-brain-octocat:new",
          "ghcr.io/acme/kody-brain-octocat:gone",
        ],
        images: [
          {
            imageRef: "ghcr.io/acme/kody-brain-octocat:old",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
      {
        imageRef: "ghcr.io/acme/kody-brain-octocat:new",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      "2026-07-02T00:00:00.000Z",
    );

    expect(file.images.map((image) => image.imageRef)).toEqual([
      "ghcr.io/acme/kody-brain-octocat:new",
      "ghcr.io/acme/kody-brain-octocat:old",
    ]);
    expect(file.forgottenImageRefs).toEqual([
      "ghcr.io/acme/kody-brain-octocat:gone",
    ]);
  });

  it("keeps saved human labels when merging GHCR-discovered images", async () => {
    const { mergeBrainSavedImages } = await import(
      "../../src/dashboard/lib/brain/image-catalog"
    );

    const images = mergeBrainSavedImages(
      {
        version: 1,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        images: [
          {
            imageRef: "ghcr.io/acme/kody-brain-octocat:new",
            label: "Stable terminal image",
            note: "Use before risky terminal tests.",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
      [
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:new",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    );

    expect(images[0]).toMatchObject({
      imageRef: "ghcr.io/acme/kody-brain-octocat:new",
      label: "Stable terminal image",
      note: "Use before risky terminal tests.",
      createdAt: "2026-07-02T00:00:00.000Z",
    });
  });
});
