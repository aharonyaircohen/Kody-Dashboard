import { describe, expect, it } from "vitest";

import {
  getClientBrand,
  normalizeClientBrandLocale,
  normalizeClientBrandSlug,
} from "@dashboard/lib/client-brand";

describe("client brand config", () => {
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
});
