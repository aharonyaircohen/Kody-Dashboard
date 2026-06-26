import { describe, expect, it } from "vitest";

import { buildExplicitMemoryDraft } from "../../../app/api/kody/chat/kody/explicit-memory";

describe("explicit memory requests", () => {
  it("turns Remember: repo guidance into a project memory draft", () => {
    const draft = buildExplicitMemoryDraft(
      "Remember: for this repo, chat prompt workflows should live as capabilities that use executables",
    );

    expect(draft).toMatchObject({
      id: "for-this-repo-chat-prompt-workflows-should-live-37713e57",
      type: "project",
    });
    expect(draft?.body).toContain(
      "chat prompt workflows should live as capabilities that use executables",
    );
    expect(draft?.body).toContain("**How apply:**");
  });

  it("ignores ordinary chat messages", () => {
    expect(buildExplicitMemoryDraft("Diagnose PR #123")).toBeNull();
  });
});
