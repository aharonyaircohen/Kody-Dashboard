import { describe, it, expect } from "vitest";
import {
  composeProfile,
  fieldsFromProfile,
  type ExecutableFields,
} from "@dashboard/lib/executables/profile";

const base: ExecutableFields = {
  slug: "research",
  describe: "d",
  prompt: "p",
  model: "inherit",
  permissionMode: "acceptEdits",
  tools: ["Read", "Grep"],
  skills: [],
  shellScripts: [],
  mcpServers: [
    { name: "codegraph", command: "codegraph", args: ["serve", "--mcp"] },
  ],
  landing: "comment",
};

function claudeCode(profile: Record<string, unknown>): Record<string, unknown> {
  return profile.claudeCode as Record<string, unknown>;
}

describe("executable profile — MCP tool servers", () => {
  it("writes mcpServers into claudeCode and auto-allows each server", () => {
    const cc = claudeCode(composeProfile(base));
    expect(cc.mcpServers).toEqual(base.mcpServers);
    // The user's checkbox tools survive, plus a derived allow-token per server.
    expect(cc.tools).toEqual(["Read", "Grep", "mcp__codegraph"]);
  });

  it("round-trips: fieldsFromProfile recovers servers and strips derived tokens", () => {
    const profile = composeProfile(base);
    const back = fieldsFromProfile("research", profile);
    expect(back.mcpServers).toEqual(base.mcpServers);
    // The mcp__ allow-token is derived, so it must not leak into the user tools.
    expect(back.tools).toEqual(["Read", "Grep"]);
  });

  it("does not accumulate stale allow-tokens across recompose cycles", () => {
    const once = composeProfile(base);
    const back = fieldsFromProfile("research", once);
    const twice = claudeCode(
      composeProfile({
        ...base,
        tools: back.tools,
        mcpServers: back.mcpServers,
      }),
    );
    expect(twice.tools).toEqual(["Read", "Grep", "mcp__codegraph"]);
  });

  it("drops the allow-token when its server is removed", () => {
    const cc = claudeCode(composeProfile({ ...base, mcpServers: [] }));
    expect(cc.mcpServers).toEqual([]);
    expect(cc.tools).toEqual(["Read", "Grep"]);
  });

  it("defaults to no servers when mcpServers is absent/malformed in the profile", () => {
    const back = fieldsFromProfile("x", {
      claudeCode: { tools: ["Read"], mcpServers: "nope" },
    });
    expect(back.mcpServers).toEqual([]);
  });
});
