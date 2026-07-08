/**
 * @fileoverview Unit tests for the chat i18n catalog: registration,
 * collision handling, param substitution, key fallback, RTL detection.
 *
 * @testFramework vitest
 * @domain chat-platform
 */
import { describe, expect, it } from "vitest";

import {
  ChatCatalogCollisionError,
  createChatCatalog,
  directionForLocale,
} from "@dashboard/lib/chat/platform/i18n";

describe("chat i18n catalog", () => {
  it("resolves registered keys and substitutes params", () => {
    const catalog = createChatCatalog("en", {
      "chat.core.send": "Send",
    });
    catalog.register({ "plugin.branding.welcome": "Hello {name}!" });
    expect(catalog.t("chat.core.send")).toBe("Send");
    expect(catalog.t("plugin.branding.welcome", { name: "Ada" })).toBe(
      "Hello Ada!",
    );
  });

  it("falls back to the key itself for unknown keys", () => {
    const catalog = createChatCatalog();
    expect(catalog.t("chat.core.unknown")).toBe("chat.core.unknown");
  });

  it("leaves unknown params untouched", () => {
    const catalog = createChatCatalog("en", { greet: "Hi {name}" });
    expect(catalog.t("greet")).toBe("Hi {name}");
    expect(catalog.t("greet", { other: "x" })).toBe("Hi {name}");
  });

  it("throws on key collisions instead of silently overwriting", () => {
    const catalog = createChatCatalog("en", { a: "1" });
    expect(() => catalog.register({ a: "2" })).toThrow(
      ChatCatalogCollisionError,
    );
  });

  it("maps locales to text direction", () => {
    expect(directionForLocale("en")).toBe("ltr");
    expect(directionForLocale("he")).toBe("rtl");
    expect(directionForLocale("he-IL")).toBe("rtl");
    expect(directionForLocale("ar_EG")).toBe("rtl");
    expect(directionForLocale("fr-CA")).toBe("ltr");
  });
});
