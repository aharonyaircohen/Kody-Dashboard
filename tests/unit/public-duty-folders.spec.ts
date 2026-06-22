import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PUBLIC_DUTIES = [
  "bug",
  "chore",
  "classify",
  "feature",
  "fix",
  "fix-ci",
  "plan",
  "qa-engineer",
  "reproduce",
  "research",
  "resolve",
  "revert",
  "review",
  "spec",
  "sync",
  "ui-review",
] as const;

describe("public Kody actions are duty folders", () => {
  it("stores every public action under .kody/duties/<slug>/", () => {
    for (const slug of PUBLIC_DUTIES) {
      const dir = `.kody/duties/${slug}`;
      const profilePath = `${dir}/profile.json`;
      const bodyPath = `${dir}/duty.md`;

      expect(existsSync(profilePath), `${slug} profile`).toBe(true);
      expect(existsSync(bodyPath), `${slug} body`).toBe(true);

      const profile = JSON.parse(readFileSync(profilePath, "utf8")) as {
        name?: string;
        action?: string;
        executable?: string;
        every?: string;
        agent?: string;
      };
      const body = readFileSync(bodyPath, "utf8");

      expect(profile.name).toBe(slug);
      expect(profile.action).toBe(slug);
      expect(profile.executable).toBe(slug);
      expect(profile.every).toBe("manual");
      expect(profile.agent).toBeTruthy();
      expect(profile.agent).toBeUndefined();
      expect(body).toContain("## Job");
      expect(body).toContain("## Executable");
      expect(body).toContain("## Restrictions");
    }
  });
});
