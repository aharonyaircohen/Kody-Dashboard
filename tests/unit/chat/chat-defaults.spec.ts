/**
 * Verifies the chat-defaults bundle structure: persona, executable,
 * duties, skills. Step 1 — TS-embedded defaults only, no repo read.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  loadChatDefaults,
  composeChatPrompt,
  composeBasePrompt,
  buildToolIndex,
  CRITICAL_REMINDERS_MD,
} from "@dashboard/lib/chat-defaults";
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
    // The legacy string's verbatim distinctive phrases (the ones the
    // model behavior depends on). The read-tool list is also pinned
    // here so a future refactor that adds a phantom tool name (one
    // that doesn't exist in the chat registry) fails this test.
    const phrases = [
      "Your prose must match the tool result",
      "injected context block",
      "Always end with a forward-driving question",
      "Never start with sycophancy",
      "Disambiguate dispatch vs. create-issue",
      "github_search_code",
      "github_get_file",
      "github_list_tree",
    "github_blame",
    "github_commits_for_path",
    "github_get_pull_request",
    "status line",
    "≤8 words",
  ];
    for (const p of phrases) {
      expect(DEFAULT_PERSONA_MD).toContain(p);
    }
  });

  it("persona does not mention phantom tools (regression: phantom tools cause hallucinations)", () => {
    // The persona must only list tools that ACTUALLY exist in the
    // chat registry. Phantom names make the model attempt calls that
    // fail silently and then fabricate results to keep the user happy.
    const phantomTools = [
      "github_get_pull_request_files",
      "github_list_branches",
      "github_get_commit",
      "github_get_tree", // wrong name; registry has `github_list_tree`
    ];
    for (const t of phantomTools) {
      expect(DEFAULT_PERSONA_MD).not.toContain(t);
    }
  });

  it("executable's tools list contains only names that exist in the chat registry", () => {
    // Every name in DEFAULT_EXECUTABLE.tools must match a tool the
    // route actually wires. If we add a name here that the registry
    // doesn't have, the model is told about a tool that doesn't
    // exist → it tries to call → call fails → it hallucinates. The
    // recent hallucination regression (do-not-invent-labels memory)
    // was caused by exactly this kind of phantom tool mention.
    const toolFiles = [
      "app/api/kody/chat/tools/github-tools.ts",
      "app/api/kody/chat/tools/pipeline-tools.ts",
      "app/api/kody/chat/tools/kody-tools.ts",
      "app/api/kody/chat/tools/task-tools.ts",
      "app/api/kody/chat/tools/bug-tools.ts",
      "app/api/kody/chat/tools/goal-tools.ts",
      "app/api/kody/chat/tools/duty-tools.ts",
      "app/api/kody/chat/tools/duty-admin-tools.ts",
      "app/api/kody/chat/tools/staff-tools.ts",
      "app/api/kody/chat/tools/staff-admin-tools.ts",
      "app/api/kody/chat/tools/executable-tools.ts",
      "app/api/kody/chat/tools/commands-tools.ts",
      "app/api/kody/chat/tools/context-tools.ts",
      "app/api/kody/chat/tools/instructions-tools.ts",
      "app/api/kody/chat/tools/variables-tools.ts",
      "app/api/kody/chat/tools/secrets-tools.ts",
      "app/api/kody/chat/tools/models-tools.ts",
      "app/api/kody/chat/tools/reports-tools.ts",
      "app/api/kody/chat/tools/notifications-tools.ts",
      "app/api/kody/chat/tools/company-tools.ts",
      "app/api/kody/chat/tools/webhooks-tools.ts",
      "app/api/kody/chat/tools/inbox-tools.ts",
      "app/api/kody/chat/tools/release-tools.ts",
      "app/api/kody/chat/tools/planner-tools.ts",
      "app/api/kody/chat/tools/vibe-tools.ts",
      "app/api/kody/chat/tools/memory-tools.ts",
      "app/api/kody/chat/tools/macros-tools.ts",
      "app/api/kody/chat/tools/remote-tools.ts",
      "app/api/kody/chat/tools/feature-tools.ts",
      "app/api/kody/chat/tools/ui-tools.ts",
      "app/api/kody/chat/tools/fetch-url.ts",
    ];
    // Two registries: tools declared inline as `tool({` in a file
    // (the common shape), and tools grouped in a map like
    // `export const uiTools = { name: tool, ... }`. The map keys
    // are the model's tool names.
    const toolKeys = new Set<string>();
    for (const f of toolFiles) {
      const src = readFileSync(f, "utf8");
      // Inline: "  name: tool({"
      for (const m of src.matchAll(
        /^\s{2,8}([a-zA-Z_][a-zA-Z0-9_]*):\s*tool\(\{/gm,
      )) {
        toolKeys.add(m[1]);
      }
      // Map keys: "  name: variableName," inside an exported object.
      // The variable is a tool built with tool({…}) earlier in the file.
      // We accept any "key: identifier," pair inside an `export const` block.
      const mapBlocks = src.matchAll(
        /export\s+const\s+\w+\s*=\s*\{([\s\S]*?)\n\};/g,
      );
      for (const block of mapBlocks) {
        for (const m of block[1].matchAll(
          /^\s{2,8}([a-zA-Z_][a-zA-Z0-9_]*):\s*\w+,?\s*$/gm,
        )) {
          toolKeys.add(m[1]);
        }
      }
    }
    // Direct imports aliased in the route — `fetch_url: fetchUrlTool`
    // is the only one currently; if more land, add them here.
    toolKeys.add("fetch_url");
    for (const name of DEFAULT_EXECUTABLE.tools) {
      expect(
        toolKeys.has(name),
        `Tool "${name}" is in the executable's allowlist but not in any chat tool file. ` +
          "The model will be told it can call this tool but the call will fail. " +
          "Either implement the tool or remove it from the allowlist.",
      ).toBe(true);
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

describe("buildToolIndex", () => {
  it("formats each tool as `- `name` — description`", () => {
    const out = buildToolIndex({
      foo: { description: "Does the foo thing." },
      bar: { description: "Does the bar thing." },
    } as never);
    expect(out).toContain("- `foo` — Does the foo thing.");
    expect(out).toContain("- `bar` — Does the bar thing.");
  });

  it("truncates long descriptions to the first sentence or ~240 chars", () => {
    const long =
      "First sentence here. Second sentence that is way past the cap so it should be cut off at the first boundary.";
    const out = buildToolIndex({
      foo: { description: long },
    } as never);
    expect(out).toContain("First sentence here.");
    expect(out).not.toContain("Second sentence");
  });

  it("falls back to `- `name`` when a tool has no description", () => {
    const out = buildToolIndex({
      foo: { description: "" },
      bar: {},
    } as never);
    expect(out).toContain("- `foo`");
    expect(out).toContain("- `bar`");
  });
});

describe("composeBasePrompt toolIndex option", () => {
  it("includes a `## Tool index` block when toolIndex is provided", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeBasePrompt(bundle, {
      toolIndex: "- `github_search_code` — find candidate files",
    });
    expect(prompt).toContain("## Tool index");
    expect(prompt).toContain("`github_search_code` — find candidate files");
  });

  it("omits the Tool index block when toolIndex is not provided", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeBasePrompt(bundle);
    expect(prompt).not.toContain("## Tool index");
  });
});

describe("CRITICAL_REMINDERS_MD", () => {
  it("is a non-empty markdown string with the key reminders", () => {
    expect(typeof CRITICAL_REMINDERS_MD).toBe("string");
    expect(CRITICAL_REMINDERS_MD.length).toBeGreaterThan(100);
    expect(CRITICAL_REMINDERS_MD).toContain("## Critical reminders");
    expect(CRITICAL_REMINDERS_MD).toContain("Read the repo before answering");
    expect(CRITICAL_REMINDERS_MD).toContain("Verify before claiming");
    expect(CRITICAL_REMINDERS_MD).toContain("No fabrication");
    expect(CRITICAL_REMINDERS_MD).toContain("Cite your evidence");
    expect(CRITICAL_REMINDERS_MD).toContain("forward-driving question");
    expect(CRITICAL_REMINDERS_MD).toContain("No sycophantic openers");
  });
});

describe("persona: verify-before-claiming rule", () => {
  it("persona contains a hard rule requiring verification before claiming", () => {
    // The do-not-invent-labels memory is a symptom of a missing hard
    // rule. The persona must have an explicit verify-before-claiming
    // rule so the model holds the line even when memory isn't read.
    expect(DEFAULT_PERSONA_MD).toMatch(/verify before claiming/i);
    expect(DEFAULT_PERSONA_MD).toMatch(/do not invent|inventing/i);
  });
});
