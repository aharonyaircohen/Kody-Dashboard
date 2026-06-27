import { beforeEach, describe, expect, it, vi } from "vitest";

const githubClient = vi.hoisted(() => ({
  getStoreRef: vi.fn(() => null),
  getStoreRepoUrl: vi.fn(() => null),
}));

vi.mock("@dashboard/lib/github-client", () => githubClient);

import { getCompanyStoreTarget } from "@dashboard/lib/company-store/assets";

describe("Company Store defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KODY_COMPANY_STORE;
    delete process.env.KODY_COMPANY_STORE_REF;
  });

  it("defaults to the stable kody-company-store catalog", () => {
    expect(getCompanyStoreTarget()).toEqual({
      owner: "aharonyaircohen",
      repo: "kody-company-store",
      ref: "stable",
    });
  });
});
