import { afterEach, describe, expect, it } from "vitest";

import { defaultClientBrandRepoContext } from "@dashboard/lib/client-brand-default-repo";

const ORIGINAL = process.env.KODY_CLIENT_BRAND_REPO;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.KODY_CLIENT_BRAND_REPO;
  else process.env.KODY_CLIENT_BRAND_REPO = ORIGINAL;
});

describe("defaultClientBrandRepoContext", () => {
  it("parses owner/repo", () => {
    process.env.KODY_CLIENT_BRAND_REPO = "acme/site";
    expect(defaultClientBrandRepoContext()).toEqual({
      owner: "acme",
      repo: "site",
    });
  });

  it("returns null when unset", () => {
    delete process.env.KODY_CLIENT_BRAND_REPO;
    expect(defaultClientBrandRepoContext()).toBeNull();
  });

  it.each(["", "  ", "just-owner", "/repo", "owner/"])(
    "returns null for malformed value %j",
    (value) => {
      process.env.KODY_CLIENT_BRAND_REPO = value;
      expect(defaultClientBrandRepoContext()).toBeNull();
    },
  );

  it("trims whitespace around parts", () => {
    process.env.KODY_CLIENT_BRAND_REPO = " acme / site ";
    expect(defaultClientBrandRepoContext()).toEqual({
      owner: "acme",
      repo: "site",
    });
  });
});
