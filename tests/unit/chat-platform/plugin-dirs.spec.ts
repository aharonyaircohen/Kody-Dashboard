/**
 * @fileoverview Step 7 enforcement guard: the eslint lint zones must cover
 * every plugin directory that actually exists. eslint.config.mjs builds its
 * per-plugin no-sibling-import zones from the shared CHAT_PLUGIN_DIRS
 * constant (src/dashboard/lib/chat/plugins/plugin-dirs.mjs); this spec fails
 * the unit gate whenever a directory is added under chat/plugins/ without
 * extending that list (or vice versa), and pins that the eslint config
 * really imports the shared module rather than a drifting inline copy.
 *
 * @testFramework vitest
 * @domain chat-platform
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Plain .mjs on purpose — shared with eslint.config.mjs, which runs under
// node without a TS loader (allowJs lets tsc type it from the source).
import { CHAT_PLUGIN_DIRS } from "../../../src/dashboard/lib/chat/plugins/plugin-dirs.mjs";

const PLUGINS_DIR = resolve(process.cwd(), "src/dashboard/lib/chat/plugins");

describe("chat plugin lint-zone coverage", () => {
  it("CHAT_PLUGIN_DIRS matches the directories on disk", () => {
    const onDisk = readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect([...CHAT_PLUGIN_DIRS].sort()).toEqual(onDisk);
  });

  it("eslint.config.mjs derives its zones from the shared constant", () => {
    const config = readFileSync(
      resolve(process.cwd(), "eslint.config.mjs"),
      "utf8",
    );
    expect(config).toContain(
      'import { CHAT_PLUGIN_DIRS } from "./src/dashboard/lib/chat/plugins/plugin-dirs.mjs"',
    );
    // The zones must be BUILT from the list — both the relative-path zones
    // and the alias-form per-plugin blocks map over it.
    expect(config).toContain("...CHAT_PLUGIN_DIRS.map((dir) => ({");
    // No re-declared inline copy shadowing the shared module.
    expect(config).not.toMatch(/const CHAT_PLUGIN_DIRS\s*=/);
  });
});
