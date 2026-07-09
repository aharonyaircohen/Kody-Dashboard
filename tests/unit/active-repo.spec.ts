import { describe, expect, it } from "vitest";
import { resolveActiveRepo } from "@dashboard/lib/active-repo";

const entry = (
  owner: string,
  repo: string,
  token: string,
  isLogin = false,
) => ({
  repoUrl: `https://github.com/${owner}/${repo}`,
  owner,
  repo,
  token,
  addedAt: 0,
  isLogin,
});

const auth = {
  owner: "a",
  repo: "one",
  token: "t-one",
  repos: [entry("a", "one", "t-one", true), entry("b", "two", "t-two")],
};

describe("resolveActiveRepo", () => {
  it("URL wins over the stored flat selection", () => {
    const active = resolveActiveRepo(auth, "/repo/b/two/tasks");
    expect(active).toMatchObject({ owner: "b", repo: "two", token: "t-two", index: 1 });
  });

  it("matches the URL repo case-insensitively", () => {
    const active = resolveActiveRepo(auth, "/repo/B/Two");
    expect(active?.index).toBe(1);
  });

  it("falls back to the stored flat selection on repo-less pages", () => {
    const active = resolveActiveRepo(auth, "/settings");
    expect(active).toMatchObject({ owner: "a", repo: "one", index: 0 });
  });

  it("falls back through login entry when flat selection is stale", () => {
    const stale = { ...auth, owner: "gone", repo: "gone" };
    const active = resolveActiveRepo(stale, "/org");
    expect(active?.index).toBe(0);
  });

  it("URL naming an unknown repo falls back to a working selection", () => {
    const active = resolveActiveRepo(auth, "/repo/x/unknown");
    expect(active).toMatchObject({ owner: "a", repo: "one", index: 0 });
  });

  it("honors a legacy flat-only blob (no repos[])", () => {
    const active = resolveActiveRepo(
      { owner: "solo", repo: "app", token: "t" },
      "/",
    );
    expect(active).toMatchObject({ owner: "solo", repo: "app", token: "t", index: -1 });
  });

  it("returns null when logged out", () => {
    expect(resolveActiveRepo(null, "/repo/a/one")).toBeNull();
    expect(resolveActiveRepo({}, "/repo/a/one")).toBeNull();
  });
});
