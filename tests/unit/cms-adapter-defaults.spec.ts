import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { defaultCmsAdapterSettings } from "@dashboard/lib/cms/adapter-catalog";

describe("CMS adapter defaults", () => {
  it("provides the file adapter root directory", () => {
    expect(defaultCmsAdapterSettings("file")).toEqual({
      rootDir: "cms/content",
    });
  });
});
