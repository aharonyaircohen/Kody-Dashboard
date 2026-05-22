/**
 * Unit tests for buildAgentList (src/dashboard/lib/chat/agent-entries.ts),
 * the pure function that builds the selectable chat-entry list shared by the
 * chat picker and the Settings "Default chat" selector.
 *
 * Load-bearing rules: the Brain row is a single slot (Brain-Fly XOR Brain,
 * never both), disabled models are dropped, and gateway models carry the
 * `kody:<id>` key the rest of the chat path keys off.
 */
import { describe, it, expect } from "vitest";
import {
  buildAgentList,
  type ChatModelEntry,
} from "@dashboard/lib/chat/agent-entries";
import { AGENTS } from "@dashboard/lib/agents";

const model = (over: Partial<ChatModelEntry> & { id: string }): ChatModelEntry => ({
  label: over.id,
  ...over,
});

describe("buildAgentList", () => {
  it("offers no Brain row when nothing is configured", () => {
    expect(buildAgentList(false, false, false, [])).toEqual([]);
  });

  it("offers manual Brain when configured (no Fly)", () => {
    const list = buildAgentList(true, false, false, []);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      key: "brain",
      agentId: "brain",
      modelId: null,
      name: AGENTS.brain.name,
    });
  });

  it("prefers Brain-Fly over manual Brain when Fly + chat toggle are on", () => {
    const list = buildAgentList(true, true, true, []);
    expect(list).toHaveLength(1); // single slot — never both
    expect(list[0]).toMatchObject({
      key: "brain-fly",
      agentId: "brain-fly",
      name: AGENTS["brain-fly"].name,
    });
  });

  it("shows Brain-Fly even when manual Brain is unconfigured", () => {
    const list = buildAgentList(false, true, true, []);
    expect(list.map((e) => e.key)).toEqual(["brain-fly"]);
  });

  it("falls back to manual Brain when Fly is present but the chat toggle is off", () => {
    const list = buildAgentList(true, true, false, []);
    expect(list.map((e) => e.key)).toEqual(["brain"]);
  });

  it("maps enabled models to kody:<id> entries and drops disabled ones", () => {
    const list = buildAgentList(false, false, false, [
      model({ id: "gpt-x", label: "GPT X" }),
      model({ id: "off", enabled: false }),
      model({ id: "claude-y", label: "Claude Y", enabled: true }),
    ]);
    expect(list).toEqual([
      {
        key: "kody:gpt-x",
        agentId: "kody",
        modelId: "gpt-x",
        name: "GPT X",
        description: "gpt-x",
        icon: AGENTS.kody.icon,
      },
      {
        key: "kody:claude-y",
        agentId: "kody",
        modelId: "claude-y",
        name: "Claude Y",
        description: "claude-y",
        icon: AGENTS.kody.icon,
      },
    ]);
  });

  it("orders the Brain row first, then models in input order", () => {
    const list = buildAgentList(true, false, false, [
      model({ id: "a" }),
      model({ id: "b" }),
    ]);
    expect(list.map((e) => e.key)).toEqual(["brain", "kody:a", "kody:b"]);
  });
});
