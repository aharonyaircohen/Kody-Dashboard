import { describe, expect, it } from "vitest";

import {
  parseStateRepoSlug,
  resolveStateRepoConfig,
} from "@dashboard/lib/state-repo";

describe("state repo config", () => {
  it("parses canonical full GitHub repository URLs", () => {
    expect(parseStateRepoSlug("https://github.com/acme/kody-state")).toEqual({
      owner: "acme",
      repo: "kody-state",
    });
  });

  it("keeps legacy owner/repo references readable", () => {
    expect(parseStateRepoSlug("acme/kody-state")).toEqual({
      owner: "acme",
      repo: "kody-state",
    });
  });

  it("defaults state repo to a full GitHub URL", () => {
    expect(
      resolveStateRepoConfig(
        { defaultImplementation: "run" },
        "acme",
        "widgets",
      ),
    ).toEqual({
      repo: "https://github.com/acme/kody-state",
      path: "widgets",
      branch: "main",
    });
  });
});
