import { describe, expect, it } from "vitest";

import {
  createRepoBrainScope,
  repoBrainConversationKey,
  repoBrainScopeKey,
} from "@dashboard/lib/brain/repo-scope";

describe("Repo Brain scope", () => {
  it("builds a display slug plus a normalized key", () => {
    const scope = createRepoBrainScope({
      owner: " A-Guy-educ ",
      repo: " Kody-Dashboard ",
      storeRepoUrl: " https://github.com/acme/kody-store ",
      storeRef: " main ",
    });

    expect(scope).toEqual({
      type: "repo",
      owner: "A-Guy-educ",
      repo: "Kody-Dashboard",
      repoSlug: "A-Guy-educ/Kody-Dashboard",
      key: "a-guy-educ/kody-dashboard",
      storeRepoUrl: "https://github.com/acme/kody-store",
      storeRef: "main",
    });
  });

  it("rejects missing owner or repo", () => {
    expect(() => createRepoBrainScope({ owner: "acme" })).toThrow(
      "Repo Brain scope requires owner and repo",
    );
    expect(() => createRepoBrainScope({ repo: "widgets" })).toThrow(
      "Repo Brain scope requires owner and repo",
    );
  });

  it("uses norepo when no dashboard repo is available", () => {
    expect(repoBrainScopeKey(null)).toBe("norepo");
    expect(repoBrainScopeKey({ owner: "acme", repo: "" })).toBe("norepo");
  });

  it("keeps Brain conversations isolated by repo and target", () => {
    const repoA = repoBrainScopeKey({ owner: "Acme", repo: "Widgets" });
    const repoB = repoBrainScopeKey({ owner: "Acme", repo: "Api" });

    expect(repoBrainConversationKey(repoA, { type: "task", id: 5 })).toBe(
      "acme/widgets::task-5",
    );
    expect(repoBrainConversationKey(repoB, { type: "task", id: 5 })).toBe(
      "acme/api::task-5",
    );
    expect(
      repoBrainConversationKey(repoA, {
        type: "capability",
        slug: "release-notes",
      }),
    ).toBe("acme/widgets::capability-release-notes");
    expect(
      repoBrainConversationKey(repoA, { type: "global", sessionId: "s1" }),
    ).toBe("acme/widgets::global-s1");
  });
});
