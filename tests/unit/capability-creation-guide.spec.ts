import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { loadChatDefaults } from "../../src/dashboard/lib/chat-defaults";
import { DEFAULT_CHAT_CAPABILITY } from "../../src/dashboard/lib/chat-defaults/defaults";

const CAPABILITY_GUIDE = readFileSync("docs/capabilities.md", "utf8");
const CAPABILITY_TOOLS_SOURCE = readFileSync(
  "app/api/kody/chat/tools/capability-tools.ts",
  "utf8",
);

describe("capability creation guide wiring", () => {
  it("documents the user-facing capability contract", () => {
    expect(CAPABILITY_GUIDE).toContain(
      "A **capability** is a reusable way the agency can produce a result.",
    );
    expect(CAPABILITY_GUIDE).toContain(".kody/capabilities/<slug>/");
    expect(CAPABILITY_GUIDE).toContain("`create_or_update_capability`");
    expect(CAPABILITY_GUIDE).toContain("The capability only defines what can be run.");
  });

  it("exposes a guide tool before capability creation", () => {
    expect(CAPABILITY_TOOLS_SOURCE).toContain("read_capability_creation_guide");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("canCreateCapability: true");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("docs/capabilities.md");
    expect(CAPABILITY_TOOLS_SOURCE).toContain(
      "Before calling it, call read_capability_creation_guide",
    );
    expect(DEFAULT_CHAT_CAPABILITY.tools).toContain("read_capability_creation_guide");
  });

  it("exposes a unified create-or-update tool", () => {
    expect(CAPABILITY_TOOLS_SOURCE).toContain("create_or_update_capability");
    expect(DEFAULT_CHAT_CAPABILITY.tools).toContain("create_or_update_capability");
    expect(DEFAULT_CHAT_CAPABILITY.tools).not.toContain("create_or_update_executable");
    expect(DEFAULT_CHAT_CAPABILITY.tools).not.toContain(
      "create_or_update_executable",
    );
  });

  it("uses capability storage and workflow dispatch", () => {
    expect(CAPABILITY_TOOLS_SOURCE).toContain("listCapabilityFiles");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("readCapabilityFile");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("writeCapabilityFile");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("deleteCapabilityFile");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("inputs: { capability: action }");
  });

  it("defaults Kody chat to the capability creation skill", async () => {
    const bundle = await loadChatDefaults("acme", "repo");
    const createCapability = bundle.skills["create-capability"];

    expect(createCapability).toBeDefined();
    expect(createCapability!.body).toContain("`read_capability_creation_guide`");
    expect(createCapability!.body).toContain("`create_or_update_capability`");
    expect(DEFAULT_CHAT_CAPABILITY.skills).toContain("create-capability");
    expect(DEFAULT_CHAT_CAPABILITY.skills).not.toContain("create-executable");
  });
});
