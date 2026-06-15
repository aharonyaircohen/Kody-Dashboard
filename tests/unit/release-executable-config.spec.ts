import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as T;
}

function readText(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("release executable config", () => {
  it("uses one release executable wired from the release duty", () => {
    const duty = readJson<{ executable: string; executables?: string[] }>(
      ".kody/duties/release/profile.json",
    );

    expect(duty.executable).toBe("release");
    expect(duty.executables).toBeUndefined();
    expect(existsSync(join(root, ".kody/executables/release"))).toBe(true);
  });

  it("keeps the four release skills inside the single executable", () => {
    const profile = readJson<{
      name: string;
      inputs: Array<{ name: string; flag: string; type: string }>;
      claudeCode: { skills: string[] };
      scripts: { preflight: Array<Record<string, string>> };
    }>(".kody/executables/release/profile.json");

    expect(profile.name).toBe("release");
    expect(profile.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "issue",
          flag: "--issue",
          type: "int",
        }),
        expect.objectContaining({ name: "bump", flag: "--bump", type: "enum" }),
        expect.objectContaining({
          name: "dry-run",
          flag: "--dry-run",
          type: "bool",
        }),
        expect.objectContaining({
          name: "prefer",
          flag: "--prefer",
          type: "enum",
        }),
      ]),
    );
    expect(profile.claudeCode.skills).toEqual([
      "release-prepare",
      "release-merge",
      "release-tag",
      "release-promote",
    ]);
    expect(profile.scripts.preflight).toEqual([
      { script: "buildSyntheticPlugin" },
      { script: "loadIssueContext" },
      { script: "composePrompt" },
    ]);
  });

  it("documents both single-main and dev-to-main branch policies", () => {
    const prompt = readText(".kody/executables/release/prompt.md");
    const prepareSkill = readText(
      ".kody/executables/release/skills/release-prepare/SKILL.md",
    );

    expect(prompt).toContain("RELEASE_FLOW");
    expect(prompt).toContain("integrationBranch equals productionBranch");
    expect(prompt).toContain("create the version PR into that same branch");
    expect(prompt).toContain(
      "create a promotion PR from integration to production",
    );
    expect(prepareSkill).toContain(
      "version PR target is the integration branch",
    );
  });

  it("sets this repo to the single-main release flow", () => {
    const variables = readJson<{
      variables: { RELEASE_FLOW: { value: string } };
    }>(".kody/variables.json");

    expect(JSON.parse(variables.variables.RELEASE_FLOW.value)).toEqual({
      integrationBranch: "main",
      productionBranch: "main",
    });
  });
});
