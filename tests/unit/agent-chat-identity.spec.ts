import { describe, expect, it } from "vitest";
import {
  appendAgentChatSpeakerOverride,
  buildAgentChatIdentity,
  buildAgentChatSpeakerOverride,
} from "@dashboard/lib/agent-chat-identity";

describe("buildAgentChatIdentity", () => {
  const agent = {
    slug: "pedagogical-math-manager",
    title: "Pedagogical Math Manager",
    body: "## Agent\nHelp teachers explain math clearly.",
  };

  it("frames a repo agent as the immediate chat speaker", () => {
    const prompt = buildAgentChatIdentity(agent);

    expect(prompt).toContain("addressed as @pedagogical-math-manager");
    expect(prompt).toContain("answer directly as this agent");
    expect(prompt).toContain("Do not dispatch a GitHub run");
    expect(prompt).toContain("Help teachers explain math clearly.");
  });

  it("adds a late speaker override for addressed-agent turns", () => {
    const prompt = buildAgentChatSpeakerOverride(agent);

    expect(prompt).toContain("Addressed agent speaker override");
    expect(prompt).toContain("Reply in first person as this agent");
    expect(prompt).toContain(
      "Do not describe this agent from Kody's point of view",
    );
    expect(prompt).toContain("Do not call tools just to learn who you are");
  });

  it("appends addressed-agent override after the existing prompt", () => {
    const prompt = appendAgentChatSpeakerOverride(
      "base\n\n## Critical reminders\nStill apply.",
      agent,
    );

    expect(prompt).toMatch(
      /## Critical reminders[\s\S]*## Addressed agent speaker override/,
    );
    expect(prompt.endsWith("Help teachers explain math clearly.")).toBe(true);
  });
});
