/**
 * @fileoverview Pins the on-disk `publish-vercel` executable to its contract.
 * @testFramework vitest
 * @domain kody-executables
 *
 * The publish-vercel executable runs in the kody-engine on GitHub Actions,
 * not in the dashboard — so the dashboard has no runtime hook to exercise
 * it. The strongest smoke we CAN do here is: validate the on-disk profile
 * against the engine's `validateProfile` contract, confirm the scripts/tools
 * the engine expects are wired, and grep the prompt for the load-bearing
 * rules the issue's acceptance criteria depend on (label regex, secret
 * naming, hook-POST flow, "no PR" landing). If any of these drift, the
 * feature breaks silently for the user.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { validateProfile } from "@dashboard/lib/executables/profile";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = resolve(
  __dirname,
  "../../../.kody/executables/publish-vercel/profile.json",
);
const PROMPT_PATH = resolve(
  __dirname,
  "../../../.kody/executables/publish-vercel/prompt.md",
);

const profile = JSON.parse(readFileSync(PROFILE_PATH, "utf8")) as Record<
  string,
  unknown
>;
const prompt = readFileSync(PROMPT_PATH, "utf8");

describe("publish-vercel executable — profile.json", () => {
  it("validates against the engine's profile contract (validateProfile)", () => {
    expect(validateProfile(profile)).toEqual([]);
  });

  it("names itself `publish-vercel` and is a oneshot primitive (no PR/branch)", () => {
    expect(profile.name).toBe("publish-vercel");
    expect(profile.role).toBe("primitive");
    expect(profile.kind).toBe("oneshot");
    // The engine's `validateProfile` only allows `pr-branch` for `lifecycle`,
    // and this executable is comment-only — so the field must be absent.
    expect(profile).not.toHaveProperty("lifecycle");
    expect(profile).not.toHaveProperty("lifecycleConfig");
  });

  it("declares the single `--issue` input the trigger comment requires", () => {
    const inputs = profile.inputs as Array<Record<string, unknown>>;
    expect(inputs).toHaveLength(1);
    const [issue] = inputs;
    expect(issue.name).toBe("issue");
    expect(issue.flag).toBe("--issue");
    expect(issue.type).toBe("int");
    expect(issue.required).toBe(true);
  });

  it("gives the agent only read-only tools + Bash (no Write/Edit, block-write hook)", () => {
    const cc = profile.claudeCode as Record<string, unknown>;
    expect(cc.tools).toEqual(["Read", "Grep", "Glob", "Bash"]);
    expect(cc.hooks).toEqual(["block-write"]);
    // No MCP servers — the executable has no need for browser/codegraph MCPs.
    expect(cc.mcpServers).toEqual([]);
  });

  it("wires the preflight (label, context, compose) and postflight (parse, post comment) the engine expects", () => {
    const scripts = profile.scripts as {
      preflight: Array<Record<string, unknown>>;
      postflight: Array<Record<string, unknown>>;
    };
    const preflightScripts = scripts.preflight.map((s) => s.script);
    const postflightScripts = scripts.postflight.map((s) => s.script);
    expect(preflightScripts).toEqual([
      "setLifecycleLabel",
      "loadIssueContext",
      "composePrompt",
    ]);
    expect(postflightScripts).toEqual(["parseAgentResult", "postAgentComment"]);
    // The setLifecycleLabel preflight must use the kody:publishing-vercel label.
    const setLabel = scripts.preflight[0] as { with: { label: string } };
    expect(setLabel.with.label).toBe("kody:publishing-vercel");
  });
});

describe("publish-vercel executable — prompt.md (issue acceptance criteria, encoded)", () => {
  it("encodes the label regex the issue requires (vercel:acct:proj, exactly two colons)", () => {
    expect(prompt).toMatch(/\^vercel:\[\^:\]\+:\[\^:\]\+\$/);
  });

  it("encodes the secret-naming rule and at least one worked example from the issue", () => {
    expect(prompt).toMatch(/VERCEL_HOOK_/);
    // The issue explicitly gives this example — pin it.
    expect(prompt).toContain("`vercel:acme:marketing-site`");
    expect(prompt).toContain("`VERCEL_HOOK_ACME_MARKETING_SITE`");
    // The rule itself: uppercase + non-alphanumeric → `_`.
    expect(prompt).toMatch(/uppercase/i);
    expect(prompt).toMatch(/non-alphanumeric|not `A.Z` or `0.9`/);
  });

  it("tells the agent to POST (empty body) and to read the URL from the env var, not from disk", () => {
    expect(prompt).toMatch(/curl\s+-sS\s+-X\s+POST/);
    // The prompt shows the env-var read with `<ACCOUNT>_<PROJECT>` placeholders
    // that the agent fills in from the label — pin the structural pattern.
    expect(prompt).toMatch(/\$\{VERCEL_HOOK_/);
    // The env var comes from the engine's vault-mirror (install.ts →
    // mirrorVaultToActionsSecrets), not from `.kody/secrets.enc` on disk.
    expect(prompt).toMatch(/secrets\.enc/);
  });

  it("tells the agent to surface a 'no matching label' / missing-secret comment instead of failing", () => {
    expect(prompt).toMatch(/no\s+labels?\s+match/i);
    expect(prompt).toMatch(/missing\s+secret/i);
    // A missing label is reported inside PR_SUMMARY, not as FAILED.
    expect(prompt).toMatch(/NOT\s+a\s+failure/i);
  });

  it("forbids the agent from editing files, running git/gh, or polling Vercel", () => {
    expect(prompt).toMatch(/no file edits/i);
    expect(prompt).toMatch(/no `?git`?\/?`?gh`?/i);
    expect(prompt).toMatch(/do not wait for the deploy/i);
  });

  it("ends with the engine's mandatory DONE / PR_SUMMARY contract (required for parseAgentResult)", () => {
    expect(prompt).toMatch(
      /<!--\s*kody:output-format[\s\S]*DONE\s*\n\s*PR_SUMMARY:/,
    );
  });
});
