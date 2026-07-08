import { describe, expect, it } from "vitest";

import { getClientSurfaceCatalog } from "@dashboard/lib/client-chat-strings";

describe("client surface string catalog", () => {
  it("produces the exact pre-catalog en strings (byte-identical contract)", () => {
    const catalog = getClientSurfaceCatalog("en");
    expect(catalog.t("chat.client.metaTitle", { brand: "Kody" })).toBe(
      "Kody Chat",
    );
    expect(catalog.t("chat.client.metaDescription", { brand: "Kody" })).toBe(
      "Chat with Kody.",
    );
    expect(catalog.t("chat.client.chatRegionLabel")).toBe("Kody chat");
  });

  it("falls back to en defaults for locales without translations", () => {
    const catalog = getClientSurfaceCatalog("he");
    expect(catalog.locale).toBe("he");
    expect(catalog.t("chat.client.metaDescription", { brand: "Kody" })).toBe(
      "Chat with Kody.",
    );
  });
});
