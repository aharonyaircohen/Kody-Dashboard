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

describe("grouped duty config", () => {
  it("groups hourly delivery graph duties behind one executable", () => {
    const duty = readJson<{
      executable: string;
      executables?: string[];
      every: string;
      writesTo: string[];
    }>(".kody/duties/delivery-graph/profile.json");
    const profile = readJson<{
      claudeCode: { skills: string[] };
      scripts: { preflight: Array<{ script?: string; shell?: string }> };
    }>(".kody/executables/delivery-graph/profile.json");

    expect(duty.executable).toBe("delivery-graph");
    expect(duty.executables).toBeUndefined();
    expect(duty.every).toBe("1h");
    expect(duty.writesTo).toEqual(["ci-health-graph", "pr-graph"]);
    expect(profile.claudeCode.skills).toEqual(["ci-health-graph", "pr-graph"]);
    expect(profile.scripts.preflight).toEqual([
      { script: "buildSyntheticPlugin" },
      { shell: "refresh-delivery-graphs.sh" },
      { script: "skipAgent" },
    ]);
    expect(readText(".kody/executables/delivery-graph/prompt.md")).toContain(
      "skips the agent",
    );
  });

  it("groups daily repo graph duties behind one executable", () => {
    const duty = readJson<{
      executable: string;
      executables?: string[];
      every: string;
      writesTo: string[];
    }>(".kody/duties/repo-graph/profile.json");
    const profile = readJson<{
      claudeCode: { skills: string[] };
      scripts: { preflight: Array<{ script?: string; shell?: string }> };
    }>(".kody/executables/repo-graph/profile.json");

    expect(duty.executable).toBe("repo-graph");
    expect(duty.executables).toBeUndefined();
    expect(duty.every).toBe("1d");
    expect(duty.writesTo).toEqual(["dependency-graph", "docs-graph"]);
    expect(profile.claudeCode.skills).toEqual([
      "dependency-graph",
      "docs-graph",
    ]);
    expect(profile.scripts.preflight).toEqual([
      { script: "buildSyntheticPlugin" },
      { shell: "refresh-repo-graphs.sh" },
      { script: "skipAgent" },
    ]);
  });

  it("groups docs drift and code coverage behind one docs health duty", () => {
    const duty = readJson<{
      executable: string;
      executables?: string[];
      every: string;
      mentions: string[];
    }>(".kody/duties/docs-health/profile.json");
    const profile = readJson<{
      claudeCode: { skills: string[] };
      scripts: { preflight: Array<{ script?: string }> };
    }>(".kody/executables/docs-health/profile.json");

    expect(duty.executable).toBe("docs-health");
    expect(duty.executables).toBeUndefined();
    expect(duty.every).toBe("1d");
    expect(duty.mentions).toEqual(["aguyaharonyair"]);
    expect(profile.claudeCode.skills).toEqual(["docs-readme", "docs-code"]);
    expect(profile.scripts.preflight).toEqual([
      { script: "buildSyntheticPlugin" },
      { script: "composePrompt" },
    ]);
  });

  it("groups disabled daily quality watches behind one executable", () => {
    const duty = readJson<{
      executable: string;
      every: string;
      runner: string;
      disabled: boolean;
    }>(".kody/duties/quality-watch/profile.json");
    const profile = readJson<{
      claudeCode: { skills: string[] };
      output: { actionTypes: string[] };
    }>(".kody/executables/quality-watch/profile.json");

    expect(duty).toMatchObject({
      executable: "quality-watch",
      every: "1d",
      runner: "cto",
      disabled: true,
    });
    expect(profile.claudeCode.skills).toEqual([
      "security-audit",
      "coverage-floor",
      "flaky-test-quarantine",
    ]);
    expect(profile.output.actionTypes).toContain("QUALITY_WATCH_COMPLETED");
  });

  it("groups disabled weekly code-health watches behind one executable", () => {
    const duty = readJson<{
      executable: string;
      every: string;
      runner: string;
      disabled: boolean;
    }>(".kody/duties/code-health/profile.json");
    const profile = readJson<{
      claudeCode: { skills: string[] };
      output: { actionTypes: string[] };
    }>(".kody/executables/code-health/profile.json");

    expect(duty).toMatchObject({
      executable: "code-health",
      every: "7d",
      runner: "cto",
      disabled: true,
    });
    expect(profile.claudeCode.skills).toEqual([
      "architecture-audit",
      "type-debt",
    ]);
    expect(profile.output.actionTypes).toContain("CODE_HEALTH_COMPLETED");
  });

  it("groups disabled cleanup watches behind one executable", () => {
    const duty = readJson<{
      executable: string;
      every: string;
      runner: string;
      disabled: boolean;
    }>(".kody/duties/cleanup/profile.json");
    const profile = readJson<{
      claudeCode: { skills: string[] };
      output: { actionTypes: string[] };
    }>(".kody/executables/cleanup/profile.json");

    expect(duty).toMatchObject({
      executable: "cleanup",
      every: "1d",
      runner: "coo",
      disabled: true,
    });
    expect(profile.claudeCode.skills).toEqual([
      "clear-empty-goals",
      "cleanup-branches",
      "dependency-bump",
      "dead-code-sweep",
    ]);
    expect(profile.output.actionTypes).toContain("CLEANUP_COMPLETED");
  });

  it("removes the individual scheduled duty folders that are now grouped", () => {
    for (const slug of [
      "ci-health-graph",
      "pr-graph",
      "dependency-graph",
      "docs-graph",
      "docs-code",
      "docs-readme",
      "security-audit",
      "coverage-floor",
      "flaky-test-quarantine",
      "architecture-audit",
      "type-debt",
      "dead-code-sweep",
      "dependency-bump",
      "test-ex",
      "chain-test",
      "inbox-ping",
      "publish-release",
      "cleanup-branches",
      "clear-empty-goals",
      "repo-maintenance",
    ]) {
      expect(existsSync(join(root, `.kody/duties/${slug}/profile.json`))).toBe(
        false,
      );
      expect(existsSync(join(root, `.kody/duties/${slug}/duty.md`))).toBe(
        false,
      );
    }
  });

  it("removes retired diagnostic and redundant executables", () => {
    for (const slug of [
      "inbox-ping",
      "publish-release",
      "noop-1",
      "noop-2",
      "cleanup-branches",
      "clear-empty-goals",
      "repo-maintenance",
    ]) {
      expect(
        existsSync(join(root, `.kody/executables/${slug}/profile.json`)),
      ).toBe(false);
    }

    const publishCommand = readText(".kody/commands/publish.md");
    expect(publishCommand).toContain("consolidated `release` executable");
    expect(publishCommand).toContain("removed `publish-release` duty");
  });
});
