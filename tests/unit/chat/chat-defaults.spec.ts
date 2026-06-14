/**
 * Verifies the chat-defaults bundle structure: persona, executable,
 * duties, skills. Step 1 — TS-embedded defaults only, no repo read.
 */

import { describe, expect, it } from "vitest";
import { loadChatDefaults, composeChatPrompt } from "@dashboard/lib/chat-defaults";
import {
  DEFAULT_PERSONA_MD,
  DEFAULT_EXECUTABLE,
  DEFAULT_DUTIES,
  DEFAULT_SKILLS,
} from "@dashboard/lib/chat-defaults/defaults";
import { AGENT_KODY } from "@dashboard/lib/agents";

describe("chat-defaults bundle", () => {
  it("returns the TS-embedded defaults from the loader", async () => {
    const bundle = await loadChatDefaults("acme", "widget");
    expect(bundle.persona).toBe(DEFAULT_PERSONA_MD);
    expect(bundle.executable).toEqual(DEFAULT_EXECUTABLE);
    expect(bundle.duties).toEqual(DEFAULT_DUTIES);
    expect(bundle.skills).toEqual(DEFAULT_SKILLS);
  });

  it("persona preserves the legacy AGENT_KODY.systemPrompt hard rules + tool policy (regression guard)", () => {
    // The persona text is now data, but the rules must not drift. The
    // chat-kody-direct integration tests assert the same invariants against
    // the bundle; this unit test pins the section boundaries so a future
    // refactor that drops # Hard rules or # Tool policy fails fast.
    expect(DEFAULT_PERSONA_MD).toContain("# Hard rules");
    expect(DEFAULT_PERSONA_MD).toContain("# Tool policy");
    // The legacy string's verbatim distinctive phrases.
    const phrases = [
      "Your prose must match the tool result",
      "injected context block",
      "Always end with a forward-driving question",
      "Never start with sycophancy",
      "Disambiguate dispatch vs. create-issue",
      "github_get_pull_request_files",
      "github_list_branches",
      "github_get_commit",
      "github_get_tree",
    ];
    for (const p of phrases) {
      expect(DEFAULT_PERSONA_MD).toContain(p);
    }
  });

  it("exposes 4 duties — kody-analyzer, kody-operator, kody-vibe, kody-mem", () => {
    const slugs = DEFAULT_DUTIES.map((d) => d.slug).sort();
    expect(slugs).toEqual([
      "kody-analyzer",
      "kody-mem",
      "kody-operator",
      "kody-vibe",
    ]);
  });

  it("groups the right skills under the right duty", () => {
    const analyzer = DEFAULT_DUTIES.find((d) => d.slug === "kody-analyzer");
    const operator = DEFAULT_DUTIES.find((d) => d.slug === "kody-operator");
    const vibe = DEFAULT_DUTIES.find((d) => d.slug === "kody-vibe");
    const mem = DEFAULT_DUTIES.find((d) => d.slug === "kody-mem");

    expect(analyzer!.body).toContain("diagnose-pr");
    expect(analyzer!.body).toContain("report-advise");
    expect(analyzer!.body).toContain("goal-planner");

    expect(operator!.body).toContain("create-issue");
    expect(operator!.body).toContain("create-duty");
    expect(operator!.body).toContain("create-staff");

    expect(vibe!.body).toContain("vibe");
    expect(mem!.body).toContain("memory");
  });

  it("exposes 8 skills — diagnose-pr, report-advise, goal-planner, create-issue, create-duty, create-staff, vibe, memory", () => {
    expect(Object.keys(DEFAULT_SKILLS).sort()).toEqual([
      "create-duty",
      "create-issue",
      "create-staff",
      "diagnose-pr",
      "goal-planner",
      "memory",
      "report-advise",
      "vibe",
    ]);
  });

  it("executable's skills array matches the keys of DEFAULT_SKILLS", () => {
    const skillSlugs = Object.keys(DEFAULT_SKILLS).sort();
    const execSkills = [...DEFAULT_EXECUTABLE.skills].sort();
    expect(execSkills).toEqual(skillSlugs);
  });

  it("executable's tools array is a flat list of names (no objects)", () => {
    for (const t of DEFAULT_EXECUTABLE.tools) {
      expect(typeof t).toBe("string");
    }
    expect(DEFAULT_EXECUTABLE.tools.length).toBeGreaterThan(0);
  });

  it("executable's tools list is deduped", () => {
    const seen = new Set(DEFAULT_EXECUTABLE.tools);
    expect(seen.size).toBe(DEFAULT_EXECUTABLE.tools.length);
  });

  it("executable exposes the workflow/pipeline status tools (regression: chat must recognize workflow status)", () => {
    // Regression guard — the chat used to lose these and started telling
    // users it had no access to workflow runs. If a future refactor drops
    // any of these, this test fails.
    const required = [
      "kody_get_pipeline_status",
      "kody_list_workflow_runs",
      "kody_list_open_prs",
    ];
    for (const t of required) {
      expect(DEFAULT_EXECUTABLE.tools).toContain(t);
    }
  });

  it("executable's tool names match the chat registry naming (no camelCase drift)", () => {
    // Guard against future renames that don't update the bundle — known
    // drift: `remoteExec` vs registry's `remote_exec`, `read_duty_creation_guide`
    // vs the real `read_executable_creation_guide`, etc.
    const known = new Set([
      "remote_exec",
      "remote_read",
      "remote_write",
      "remote_ls",
      "read_duty_creation_guide",
      "read_executable_creation_guide",
    ]);
    for (const t of DEFAULT_EXECUTABLE.tools) {
      if (t.startsWith("remote") || t.includes("creation_guide")) {
        expect(known.has(t)).toBe(true);
      }
    }
  });
});

describe("composeChatPrompt", () => {
  it("joins persona, workflows, skills, and tools into a single prompt", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeChatPrompt(bundle, {
      repo: { owner: "acme", repo: "widget" },
    });
    // Persona header.
    expect(prompt).toContain("Kody — in-process dashboard chat agent");
    // Repo block.
    expect(prompt).toContain("## Connected repository");
    expect(prompt).toContain("acme/widget");
    // Goals namespace block.
    expect(prompt).toContain("## Goals (NOT issues)");
    // Workflows header + all 4 duties.
    expect(prompt).toContain("## Workflows");
    expect(prompt).toContain("### kody-analyzer");
    expect(prompt).toContain("### kody-operator");
    expect(prompt).toContain("### kody-vibe");
    expect(prompt).toContain("### kody-mem");
    // Skills header + all 8 skills.
    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("### diagnose-pr");
    expect(prompt).toContain("### report-advise");
    expect(prompt).toContain("### goal-planner");
    expect(prompt).toContain("### create-issue");
    expect(prompt).toContain("### create-duty");
    expect(prompt).toContain("### create-staff");
    expect(prompt).toContain("### vibe");
    expect(prompt).toContain("### memory");
    // Tools allowlist.
    expect(prompt).toContain("## Tools available");
    expect(prompt).toContain("`github_search_code`");
    expect(prompt).toContain("`vibe_start_execution`");
  });

  it("omits the Connected repository block when no repo is provided", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeChatPrompt(bundle, { repo: null });
    expect(prompt).not.toContain("## Connected repository");
    expect(prompt).not.toContain("## Goals (NOT issues)");
  });

  it("appends the Current page block when currentPage is set", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeChatPrompt(bundle, {
      repo: { owner: "acme", repo: "widget" },
      currentPage: "the Variables page (/variables)",
    });
    expect(prompt).toContain("## Current page");
    expect(prompt).toContain("the Variables page (/variables)");
  });

  it("appends the Context block when context is set", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeChatPrompt(bundle, {
      repo: { owner: "acme", repo: "widget" },
      context: "### company-profile\n\nAcme builds widgets.",
    });
    expect(prompt).toContain("## Context — your default frame");
    expect(prompt).toContain("Acme builds widgets.");
  });

  it("appends the Remembered context block when memoryIndex is set", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeChatPrompt(bundle, {
      repo: { owner: "acme", repo: "widget" },
      memoryIndex: "- foo: bar",
    });
    expect(prompt).toContain("## Remembered context");
    expect(prompt).toContain("- foo: bar");
  });
});
