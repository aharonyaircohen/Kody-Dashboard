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
  // New engine duty contract (kody2 main) — a folder-duty is also a
  // duty, so the profile carries the same top-level knobs the markdown
  // duties do. These stay absent from the round-trip tests so the
  // existing MCP assertions aren't affected.
  staff: null,
  every: null,
  mentions: [],
  dutyTools: [],
  executable: null,
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

describe("executable profile — folder-duty top-level fields (kody2 main)", () => {
  // A folder-duty is also a duty. The engine reads these from the top
  // level of profile.json (not under claudeCode.*), so they take effect
  // for the scheduler the same way a markdown duty's frontmatter does.
  // Keep "agent tools" (claudeCode.tools) and "duty tools" (dutyTools)
  // visually separate: they're different allowlists.
  const dutyBase: ExecutableFields = {
    ...base,
    staff: "qa-engineer",
    every: "6h",
    mentions: ["alice", "bob"],
    dutyTools: ["Bash", "Read"],
    executable: "qa-verify",
  };

  it("writes staff, every, mentions, dutyTools, executable at the top level", () => {
    const profile = composeProfile(dutyBase);
    expect(profile.staff).toBe("qa-engineer");
    expect(profile.every).toBe("6h");
    // CSV form on disk, array form in the editor.
    expect(profile.mentions).toBe("alice, bob");
    expect(profile.dutyTools).toBe("Bash, Read");
    expect(profile.executable).toBe("qa-verify");
  });

  it("omits top-level fields when their editor values are empty / null", () => {
    // An unchanged re-save must stay byte-identical: keys with empty
    // editor values stay absent so the diff is just the user's edit.
    const profile = composeProfile(base);
    expect(profile.staff).toBeUndefined();
    expect(profile.every).toBeUndefined();
    expect(profile.mentions).toBeUndefined();
    expect(profile.dutyTools).toBeUndefined();
    expect(profile.executable).toBeUndefined();
  });

  it("round-trips staff, every, mentions, dutyTools, executable through fieldsFromProfile", () => {
    const profile = composeProfile(dutyBase);
    const back = fieldsFromProfile("research", profile);
    expect(back.staff).toBe("qa-engineer");
    expect(back.every).toBe("6h");
    expect(back.mentions).toEqual(["alice", "bob"]);
    expect(back.dutyTools).toEqual(["Bash", "Read"]);
    expect(back.executable).toBe("qa-verify");
  });

  it("strips a leading @ and trims CSV entries on read", () => {
    // On-disk CSV is a single string; the editor wants an array of clean
    // logins. This matches the markdown frontmatter's mentions parser.
    const back = fieldsFromProfile("x", {
      claudeCode: {},
      mentions: " @alice ,@bob ,  ",
      dutyTools: "Bash , Read",
    });
    expect(back.mentions).toEqual(["alice", "bob"]);
    expect(back.dutyTools).toEqual(["Bash", "Read"]);
  });

  it("defaults top-level duty fields to null/[]/null when absent on the wire", () => {
    // Legacy profiles (kody2 pre-main, or built-in executables) don't
    // have these top-level keys. The editor must still render a clean
    // empty form rather than crashing.
    const back = fieldsFromProfile("x", { claudeCode: {} });
    expect(back.staff).toBeNull();
    expect(back.every).toBeNull();
    expect(back.mentions).toEqual([]);
    expect(back.dutyTools).toEqual([]);
    expect(back.executable).toBeNull();
  });

  it("rejects an unknown every token (only the supported schedule values pass through)", () => {
    // The engine's ScheduleEvery enum is the only valid value for the
    // top-level `every` field. A legacy / typo'd string must surface
    // as `null` in the editor so the user can correct it instead of
    // committing a value the scheduler would reject.
    const back = fieldsFromProfile("x", {
      claudeCode: {},
      every: "every-five-minutes",
    });
    expect(back.every).toBeNull();
  });

  it("keeps agent tools (claudeCode.tools) separate from duty tools (dutyTools)", () => {
    // The two allowlists must NEVER cross-pollinate. This test pins
    // the editor split: tools go to claudeCode.tools, dutyTools to the
    // top level. Drift here would silently widen (or narrow) the
    // agent's runtime permissions in surprising ways.
    const profile = composeProfile({
      ...base,
      mcpServers: [], // isolate from the MCP-derived allow-token logic
      tools: ["Read", "Write", "Edit"],
      dutyTools: ["Bash"],
    });
    const cc = claudeCode(profile);
    expect(cc.tools).toEqual(["Read", "Write", "Edit"]);
    expect(profile.dutyTools).toBe("Bash");
    // And back again — neither leaks into the other.
    const back = fieldsFromProfile("x", profile);
    expect(back.tools).toEqual(["Read", "Write", "Edit"]);
    expect(back.dutyTools).toEqual(["Bash"]);
  });
});
