/**
 * Deterministic chat evals for Kody behavior.
 *
 * These do not call a model. They pin the rules that made recent bad
 * conversations fail: fake issue links, noisy clarifying questions, and
 * over-complicated prompt guidance.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { buildSystemPrompt } from "../../../app/api/kody/chat/kody/system-prompt";
import {
  loadChatDefaults,
  composeBasePrompt,
} from "@dashboard/lib/chat-defaults";
import { getCreatedIssueNumberFromToolOutput } from "@dashboard/lib/components/kody-chat-types";

const prompt = buildSystemPrompt(
  composeBasePrompt(await loadChatDefaults("acme", "repo")),
  { owner: "acme", repo: "repo" },
  undefined,
  { vibeMode: true, flyConfigured: false },
);

describe("Kody chat evals", () => {
  it("does not count read-tool issue URLs as newly created issues", () => {
    const existingIssue = {
      number: 77,
      url: "https://github.com/acme/repo/issues/77",
    };

    expect(
      getCreatedIssueNumberFromToolOutput("github_get_issue", existingIssue),
    ).toBeNull();
  });

  it("does not count failed create tools as created issues", () => {
    expect(
      getCreatedIssueNumberFromToolOutput("create_feature", {
        error: "Validation Failed",
      }),
    ).toBeNull();
  });

  it("allows create_task to transfer chat scope after real creation", () => {
    expect(
      getCreatedIssueNumberFromToolOutput("create_task", {
        number: 88,
        url: "https://github.com/acme/repo/issues/88",
      }),
    ).toBe(88);
  });

  it("tells Kody to ask at most one blocking clarifying question", () => {
    expect(prompt).toContain("Ask at most one clarifying question");
    expect(prompt).toContain(
      "If there is no blocking question, ask only for approval",
    );
  });

  it("does not encourage endless clarification loops in Vibe mode", () => {
    expect(prompt).not.toContain("Ask in small batches");
    expect(prompt).not.toContain("repeat. Stop ONLY");
  });

  it("keeps rendered view data scoped to explicit values or the active workflow step", async () => {
    const promptWithPreview = buildSystemPrompt(
      composeBasePrompt(await loadChatDefaults("acme", "repo")),
      { owner: "acme", repo: "repo" },
      undefined,
      {
        previewContext: "Preview shows a Hebrew marketing page.",
        viewRendererRules:
          "- Purpose `decision`: Use this purpose when Kody presents a decision.\n  Data keys:\n  - title (title): Short heading.\n  - body (text): Supporting text.\n  - actions (actions, default available): Available responses.",
      },
    );

    expect(promptWithPreview).toContain("Generic view rendering");
    expect(promptWithPreview).toContain(
      "Every final response must use an output tool",
    );
    expect(promptWithPreview).toContain("`final_answer` for plain text");
    expect(promptWithPreview).toContain(
      "If the user asks to show, render, or display a UI/card, that is also a render request",
    );
    expect(promptWithPreview).toContain(
      "Do not print JSON or describe the tool call",
    );
    expect(promptWithPreview).toContain(
      "Dashboard chooses the matching user-managed renderer",
    );
    expect(promptWithPreview).toContain(
      "UI-card requests are display requests, not issue-creation requests",
    );
    expect(promptWithPreview).toContain(
      "Render the requested UI; do not convert it into another workflow",
    );
    expect(promptWithPreview).toContain(
      "Use `show_view` naturally whenever your reply is presenting an interaction",
    );
    expect(promptWithPreview).toContain("The user does not need to ask for UI");
    expect(promptWithPreview).toContain(
      "`show_view` takes only `purpose` and `data`",
    );
    expect(promptWithPreview).toContain(
      "Use the renderer rule's listed Data keys as the field names",
    );
    expect(promptWithPreview).toContain(
      "fill them from the current interaction you are presenting",
    );
    expect(promptWithPreview).toContain(
      "If the user's request includes line-separated or bulleted choices",
    );
    expect(promptWithPreview).toContain(
      "first call the read/list tool needed to get the records, then call `show_view` with the matching renderer purpose",
    );
    expect(promptWithPreview).toContain(
      "Each field in `data` must come from one of two places",
    );
    expect(promptWithPreview).toContain(
      "Do not silently copy preview, page, repo, task, memory, or research context into view fields",
    );
    expect(promptWithPreview).toContain(
      "Do not name a renderer, preset, or hardcoded view type",
    );
    expect(promptWithPreview).toContain("Available renderer rules");
    expect(promptWithPreview).toContain("Purpose `decision`");
    expect(promptWithPreview).toContain(
      "Use this purpose when Kody presents a decision",
    );
    expect(promptWithPreview).toContain("Data keys:");
    expect(promptWithPreview).toContain("title (title): Short heading.");
    expect(promptWithPreview).toContain(
      "actions (actions, default available): Available responses.",
    );
  });

  it("requires a terminal output tool instead of allowing plain prose stops", () => {
    const route = readFileSync("app/api/kody/chat/kody/route.ts", "utf8");

    expect(route).toContain('toolChoice: "required"');
    expect(route).toContain("CHAT_OUTPUT_TOOL_NAMES");
    expect(route).toContain("shouldRequireViewOutputForTurn");
    expect(route).toContain("shouldAllowPreRenderToolCallsForTurn");
    expect(route).toContain("definitions: viewRendererDefinitions");
    expect(route).toContain("selectChatOutputActiveTools");
    expect(route).toContain("allActiveTools");
    expect(route).toContain("Do not finish with `final_answer`");
    expect(route).toContain("terminalToolAttempt(SHOW_VIEW_TOOL)");
    expect(route).toContain("successfulToolResult(FINAL_ANSWER_TOOL)");
  });

  it("does not retry a failed show_view finalizer forever", () => {
    const route = readFileSync("app/api/kody/chat/kody/route.ts", "utf8");

    expect(route).toContain("terminalToolAttempt(SHOW_VIEW_TOOL)");
    expect(route).toContain("successfulToolResult(FINAL_ANSWER_TOOL)");
    expect(route).not.toContain("successfulToolResult(SHOW_VIEW_TOOL)");
  });
});
