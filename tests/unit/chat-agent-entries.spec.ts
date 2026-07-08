/**
 * Unit tests for buildAgentList (src/dashboard/lib/chat/agent-entries.ts),
 * the pure function that builds the selectable chat-entry list shared by the
 * chat picker and the Settings "Default chat" selector.
 *
 * Load-bearing rules:
 * - The Live row is always present (issue #134 — chat's default is
 *   `selectedAgentId="kody-live"` and the picker must show it, not hide it).
 * - The Brain row is a single slot (Brain-Fly XOR Brain, never both).
 * - Disabled models are dropped.
 * - Gateway models carry the `kody:<id>` key the rest of the chat path
 *   keys off.
 */
import { describe, it, expect } from "vitest";
import {
  buildAgentList,
  type ChatModelEntry,
} from "@dashboard/lib/chat/platform/agent-entries";
import { AGENTS } from "@dashboard/lib/agents";
import {
  FALLBACK_REASONING,
  resolveReasoning,
} from "@dashboard/lib/chat/core/reasoning-adapter";

const model = (
  over: Partial<ChatModelEntry> & { id: string },
): ChatModelEntry => ({
  label: over.id,
  ...over,
});

describe("buildAgentList", () => {
  it("offers no Brain row when nothing is Brain-configured (Live is still offered)", () => {
    // Live is the long-lived runner and the chat's hidden default — it
    // must be in the picker even when nothing else is configured.
    const list = buildAgentList(false, false, false, []);
    const keys = list.map((e) => e.key);
    expect(keys).not.toContain("brain");
    expect(keys).toContain("kody-live");
  });

  it("offers manual Brain when configured (no Fly)", () => {
    const list = buildAgentList(true, false, false, []);
    const byKey = new Map(list.map((e) => [e.key, e]));
    expect(byKey.get("brain")).toMatchObject({
      key: "brain",
      agentId: "brain",
      modelId: null,
      name: AGENTS.brain.name,
    });
    expect(byKey.has("kody-live")).toBe(true);
  });

  it("prefers Brain-Fly over manual Brain when Fly + chat toggle are on", () => {
    const list = buildAgentList(true, true, true, []);
    // Brain single slot — Brain-Fly XOR Brain, never both
    const brainKeys = list.filter(
      (e) => e.key === "brain" || e.key === "brain-fly",
    );
    expect(brainKeys).toHaveLength(1);
    expect(brainKeys[0].key).toBe("brain-fly");
    expect(brainKeys[0].name).toBe("Repo Brain");
    expect(brainKeys[0].name).toBe(AGENTS["brain-fly"].name);
    expect(list.map((e) => e.key)).toContain("kody-live-fly");
  });

  it("shows Brain-Fly even when manual Brain is unconfigured", () => {
    const list = buildAgentList(false, true, true, []);
    expect(list.map((e) => e.key)).toEqual(["kody-live-fly", "brain-fly"]);
  });

  it("falls back to manual Brain when Fly is present but the chat toggle is off", () => {
    const list = buildAgentList(true, true, false, []);
    expect(list.map((e) => e.key)).toEqual(["kody-live-fly", "brain"]);
  });

  it("maps enabled models to kody:<id> entries and drops disabled ones", () => {
    const list = buildAgentList(false, false, false, [
      model({ id: "gpt-x", label: "GPT X" }),
      model({ id: "off", enabled: false }),
      model({ id: "claude-y", label: "Claude Y", enabled: true }),
    ]);
    const byKey = new Map(list.map((e) => [e.key, e]));
    const gptX = byKey.get("kody:gpt-x");
    expect(gptX).toMatchObject({
      key: "kody:gpt-x",
      agentId: "kody",
      modelId: "gpt-x",
      name: "GPT X",
      description: "gpt-x",
      icon: AGENTS.kody.icon,
    });
    expect(gptX?.reasoning).toEqual(FALLBACK_REASONING);
    expect(gptX?.reasoning).toEqual(
      resolveReasoning({ id: "gpt-x", label: "GPT X" }),
    );

    const claudeY = byKey.get("kody:claude-y");
    expect(claudeY).toMatchObject({
      key: "kody:claude-y",
      agentId: "kody",
      modelId: "claude-y",
      name: "Claude Y",
      description: "claude-y",
      icon: AGENTS.kody.icon,
    });
    expect(claudeY?.reasoning).toEqual(
      resolveReasoning({ id: "claude-y", label: "Claude Y" }),
    );

    expect(byKey.has("kody:off")).toBe(false);
  });

  it("orders Live first, then Brain, then models in input order", () => {
    const list = buildAgentList(true, false, false, [
      model({ id: "a" }),
      model({ id: "b" }),
    ]);
    expect(list.map((e) => e.key)).toEqual([
      "kody-live",
      "brain",
      "kody:a",
      "kody:b",
    ]);
  });

  it("orders Live-Fly first when fly is configured", () => {
    const list = buildAgentList(true, true, true, [model({ id: "a" })]);
    expect(list.map((e) => e.key)).toEqual([
      "kody-live-fly",
      "brain-fly",
      "kody:a",
    ]);
  });

  // Regression: issue #134 — "Chat creates a hidden Live runner on
  // dashboard open, before the user picks an agent". The Live entry was
  // previously omitted from the dropdown (see buildAgentList docstring),
  // so the chat's default `selectedAgentId="kody-live"` was a hidden
  // state the user couldn't see or change. The user spec is that ALL
  // agent options (including Live) must be visible in the dropdown.
  describe("issue #134 — Live is a first-class dropdown entry", () => {
    it("always surfaces a Live row, even with no Brain and no models", () => {
      const list = buildAgentList(false, false, false, []);
      expect(list.some((e) => e.key === "kody-live")).toBe(true);
    });

    it("surfaces Live alongside Brain", () => {
      const list = buildAgentList(true, false, false, []);
      const keys = list.map((e) => e.key);
      expect(keys).toContain("kody-live");
      expect(keys).toContain("brain");
    });

    it("surfaces Live alongside gateway models", () => {
      const list = buildAgentList(false, false, false, [
        model({ id: "gpt-x", label: "GPT X" }),
      ]);
      expect(list.map((e) => e.key)).toEqual(["kody-live", "kody:gpt-x"]);
    });
  });
});
