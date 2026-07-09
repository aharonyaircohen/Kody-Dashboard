import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findBrandFileFromList: vi.fn(),
  isBrandDeleted: vi.fn(),
  readBrandFile: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/brands", () => ({
  findBrandFileFromList: h.findBrandFileFromList,
  isBrandDeleted: h.isBrandDeleted,
  readBrandFile: h.readBrandFile,
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
}));

import {
  getBuiltinClientBrand,
  getClientBrand,
  normalizeClientBrandLocale,
  normalizeClientBrandSlug,
  resolveClientBrand,
} from "@dashboard/lib/client-brand";

describe("client brand config", () => {
  beforeEach(() => {
    h.findBrandFileFromList.mockReset();
    h.isBrandDeleted.mockReset();
    h.isBrandDeleted.mockResolvedValue(false);
    h.readBrandFile.mockReset();
    h.setGitHubContext.mockReset();
    h.clearGitHubContext.mockReset();
  });

  it("normalizes route slugs safely", () => {
    expect(normalizeClientBrandSlug("Kody")).toBe("kody");
    expect(normalizeClientBrandSlug(" brand--name ")).toBe("brand-name");
    expect(normalizeClientBrandSlug("bad/../slug")).toBe("bad-slug");
  });

  it("uses Kody as the generic client brand", () => {
    expect(getClientBrand("kody")).toMatchObject({
      slug: "kody",
      name: "Kody",
    });
  });

  it("creates a readable fallback brand name for unknown brands", () => {
    expect(getClientBrand("brand-name")).toMatchObject({
      slug: "brand-name",
      name: "Brand Name",
    });
  });

  it("does not treat unknown slugs as built-in brands", () => {
    expect(getBuiltinClientBrand("brand-name")).toBeNull();
  });

  it("normalizes locales and defaults to en", () => {
    expect(normalizeClientBrandLocale(undefined)).toBe("en");
    expect(normalizeClientBrandLocale("")).toBe("en");
    expect(normalizeClientBrandLocale("   ")).toBe("en");
    expect(normalizeClientBrandLocale("HE")).toBe("he");
    expect(normalizeClientBrandLocale(" he-IL ")).toBe("he-il");
    expect(normalizeClientBrandLocale("ar_EG")).toBe("ar-eg");
    expect(normalizeClientBrandLocale("not a locale!")).toBe("en");
  });

  it("keeps the default kody brand on en", () => {
    expect(getClientBrand("kody").locale).toBe("en");
  });

  it("resolves unknown brands to the en default locale", () => {
    expect(getClientBrand("brand-name").locale).toBe("en");
  });

  it("ships the RTL reference brand kody-he with locale he", () => {
    expect(getClientBrand("kody-he")).toMatchObject({
      slug: "kody-he",
      name: "Kody",
      locale: "he",
    });
  });

  it("resolves repo-defined brands before fallback brands", async () => {
    h.findBrandFileFromList.mockResolvedValue({
      slug: "acme",
      name: "Acme Support",
      accent: "#2563eb",
      locale: "he-il",
      welcomeText: "Welcome to Acme",
      modelId: "sonnet-4",
      agentSlug: "qa-agent",
      source: "repo",
      sha: "sha",
      updatedAt: "",
      htmlUrl: "",
    });

    await expect(resolveClientBrand("acme")).resolves.toMatchObject({
      slug: "acme",
      name: "Acme Support",
      accent: "#2563eb",
      locale: "he-il",
      welcomeText: "Welcome to Acme",
      modelId: "sonnet-4",
      agentSlug: "qa-agent",
    });
    expect(h.readBrandFile).not.toHaveBeenCalled();
  });

  it("uses the provided repo context when resolving public route brands", async () => {
    h.findBrandFileFromList.mockResolvedValue({
      slug: "aguy",
      name: "A Guy",
      accent: "#2563eb",
      locale: "en",
      source: "repo",
      sha: "sha",
      updatedAt: "",
      htmlUrl: "",
    });

    await expect(
      resolveClientBrand("aguy", {
        owner: "A-Guy-educ",
        repo: "A-Guy-Web",
        storeRepoUrl: "https://github.com/A-Guy-educ/kody-state",
        storeRef: "kody-state",
      }),
    ).resolves.toMatchObject({
      slug: "aguy",
      name: "A Guy",
      accent: "#2563eb",
    });

    expect(h.setGitHubContext).toHaveBeenCalledWith(
      "A-Guy-educ",
      "A-Guy-Web",
      undefined,
      "https://github.com/A-Guy-educ/kody-state",
      "kody-state",
    );
    expect(h.clearGitHubContext).toHaveBeenCalled();
  });

  it("keeps built-in fallback when no repo brand exists", async () => {
    h.findBrandFileFromList.mockResolvedValue(null);

    await expect(resolveClientBrand("acme")).resolves.toMatchObject({
      slug: "acme",
      name: "Acme",
      accent: "#7c3aed",
      locale: "en",
    });
    expect(h.readBrandFile).not.toHaveBeenCalled();
  });

  it("does not resolve a deleted built-in brand", async () => {
    h.isBrandDeleted.mockResolvedValue(true);
    h.findBrandFileFromList.mockResolvedValue(null);

    await expect(resolveClientBrand("acme")).resolves.toBeNull();
    expect(h.findBrandFileFromList).not.toHaveBeenCalled();
    expect(h.readBrandFile).not.toHaveBeenCalled();
  });

  it("does not resolve unknown public brands", async () => {
    h.findBrandFileFromList.mockResolvedValue(null);

    await expect(resolveClientBrand("random-brand")).resolves.toBeNull();
    expect(h.readBrandFile).not.toHaveBeenCalled();
  });

  it("keeps built-in fallback when repo brand lookup is unavailable", async () => {
    h.findBrandFileFromList.mockRejectedValue(new Error("missing repo context"));

    await expect(resolveClientBrand("kody-he")).resolves.toMatchObject({
      slug: "kody-he",
      name: "Kody",
      locale: "he",
    });
    expect(h.readBrandFile).not.toHaveBeenCalled();
  });
});
