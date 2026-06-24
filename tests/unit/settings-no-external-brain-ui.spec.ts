import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const settingsSource = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/SettingsManager.tsx"),
  "utf8",
);

const defaultChatSource = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/DefaultChatCard.tsx"),
  "utf8",
);

const settingsPageSource = readFileSync(
  resolve(__dirname, "../../app/(chat-rail)/settings/page.tsx"),
  "utf8",
);

describe("Settings external Brain UI", () => {
  it("does not expose the manual Brain server form in Settings", () => {
    expect(settingsSource).not.toContain("Brain server");
    expect(settingsSource).not.toContain("brain-url");
    expect(settingsSource).not.toContain("brain-key");
    expect(settingsSource).not.toContain("Clear Brain config");
    expect(settingsPageSource).not.toContain("Brain server config");
  });

  it("keeps Settings default chat focused on models and Fly Brain", () => {
    expect(defaultChatSource).toContain("Fly Brain");
    expect(defaultChatSource).toContain("enable Fly Brain");
    expect(defaultChatSource).not.toContain("set a Brain server");
    expect(defaultChatSource).not.toContain("brainConfigured");
  });
});
