/**
 * @fileoverview Integration tests for /api/kody/chat/kody (Kody direct agent).
 * @testFramework vitest
 * @domain chat-contract
 *
 * Covers request validation + provider-key plumbing without hitting the
 * live chat-model API. The SDK call is not mocked end-to-end; we assert the
 * behaviour the UI depends on: 400 on bad input, 409 + `fallback:
 * "kody-live"` when no model is resolvable or the key is missing (the UI
 * routes the turn through the Actions engine instead), auth gate before
 * doing any work.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  POST as kodyChatPOST,
  DEFAULT_MAX_STEPS,
} from "../../app/api/kody/chat/kody/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/kody", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "owner",
      "x-kody-repo": "repo",
    },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  // Auth requires this even though it's not directly used for the LLM call.
  process.env.KODY_MASTER_KEY = "kody-direct-test-secret";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/kody/chat/kody", () => {
  it("returns 409 with fallback:kody-live when no model can be resolved", async () => {
    vi.stubEnv("MY_API_KEY", "");
    vi.stubEnv("CHAT_MODEL_API_KEY", "");
    const res = await kodyChatPOST(
      makeRequest({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.fallback).toBe("kody-live");
    // Surface either path: no models configured (empty LLM_MODELS) or
    // model resolved but its api-key secret is missing.
    expect(String(data.error)).toMatch(
      /no_models_configured|model_api_key_missing|model_base_url_missing/,
    );
  });

  it("returns 400 when messages are missing", async () => {
    vi.stubEnv("MY_API_KEY", "dummy-key");
    const res = await kodyChatPOST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(String(data.error)).toMatch(/messages required/);
  });

  it("returns 400 when messages array is empty", async () => {
    vi.stubEnv("MY_API_KEY", "dummy-key");
    const res = await kodyChatPOST(makeRequest({ messages: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when all messages have empty content (after filter)", async () => {
    vi.stubEnv("MY_API_KEY", "dummy-key");
    const res = await kodyChatPOST(
      makeRequest({
        messages: [
          { role: "user", content: "   " },
          { role: "assistant", content: "" },
        ],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 when kody auth is missing (no headers, no bot token)", async () => {
    vi.stubEnv("MY_API_KEY", "dummy-key");
    vi.stubEnv("KODY_BOT_TOKEN", "");
    const req = new NextRequest("https://dash.test/api/kody/chat/kody", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await kodyChatPOST(req);
    expect([401, 403]).toContain(res.status);
  });

  it("builds a system prompt that names the connected repo + task context", async () => {
    // We can't observe the system prompt the SDK sends without mocking the
    // provider, so we unit-test buildSystemPrompt by re-importing it.
    const { buildSystemPrompt } =
      await import("../../app/api/kody/chat/kody/system-prompt");
    const prompt = buildSystemPrompt(
      "You are Kody.",
      { owner: "acme", repo: "widgets" },
      {
        issueNumber: 42,
        title: "Add dark mode",
        state: "open",
        labels: ["ui", "good-first-issue"],
        associatedPR: {
          number: 101,
          state: "open",
          html_url: "https://github.com/acme/widgets/pull/101",
        },
      },
    );
    expect(prompt).toContain("acme/widgets");
    expect(prompt).toContain("Issue #42");
    expect(prompt).toContain("Add dark mode");
    expect(prompt).toContain("ui, good-first-issue");
    expect(prompt).toContain("Associated PR: #101");
  });

  it("builds a repo-less prompt when no auth headers are present", async () => {
    const { buildSystemPrompt } =
      await import("../../app/api/kody/chat/kody/system-prompt");
    const prompt = buildSystemPrompt("base", null, undefined);
    expect(prompt).toBe("base");
  });

  it("appends a current-duty block when opts.duty is set", async () => {
    const { buildSystemPrompt } =
      await import("../../app/api/kody/chat/kody/system-prompt");
    const prompt = buildSystemPrompt("base", null, undefined, {
      duty: {
        number: 7,
        title: "Auto-triage stale issues",
        body: "## Intent\nClose stale issues",
        state: "open",
        labels: ["kody:duty"],
      },
    });
    expect(prompt).toContain("Current duty");
    expect(prompt).toContain("Duty #7");
    expect(prompt).toContain("Auto-triage stale issues");
    expect(prompt).toContain("Close stale issues");
    expect(prompt).toContain("kody:duty");
  });

  it("base kody prompt tells the model to read injected context blocks before answering", async () => {
    // Regression: model used to ignore ## Current task / Current duty /
    // Current page / Goals / Remembered context blocks and answer as if it
    // were a fresh session. Hard rule #2 now explicitly grounds answers
    // in those blocks.
    const { AGENT_KODY } = await import("../../src/dashboard/lib/agents");
    const prompt = AGENT_KODY.systemPrompt;
    expect(prompt).toMatch(/injected context block/i);
    expect(prompt).toMatch(/do NOT re-ask for facts the block already states/i);
    expect(prompt).toContain("## Current task");
    expect(prompt).toContain("## Current duty");
    expect(prompt).toContain("## Current report");
    expect(prompt).toContain("## Current page");
    expect(prompt).toContain("## Goals");
    expect(prompt).toContain("## Remembered context");
  });

  it("base kody prompt requires prose to match the tool result, with 'my read:' for inferences", async () => {
    // Regression: model used to read a tool result and then write a
    // confident summary that drifted. Hard rule #1 now requires the
    // prose to match the tool result and to prefix inferences.
    const { AGENT_KODY } = await import("../../src/dashboard/lib/agents");
    const prompt = AGENT_KODY.systemPrompt;
    expect(prompt).toMatch(/Your prose must match the tool result/i);
    expect(prompt).toContain("my read:");
  });

  it("base kody prompt always ends with a forward-driving question and bans sycophantic openers", async () => {
    // Regression: model used to close replies with no follow-up and start
    // with "Great question!" / "Sure!". Hard rule #5 now requires a
    // forward-driving question on every reply and bans a specific list of
    // sycophantic openers.
    const { AGENT_KODY } = await import("../../src/dashboard/lib/agents");
    const prompt = AGENT_KODY.systemPrompt;
    expect(prompt).toMatch(/Always end with a forward-driving question/i);
    for (const banned of [
      "Great question",
      "Sure!",
      "Of course",
      "Absolutely",
      "Happy to help",
      "Certainly",
      "I'd be glad to",
      "Thanks for asking",
      "Good catch",
    ]) {
      expect(prompt).toContain(banned);
    }
    expect(prompt).toMatch(/Never start with sycophancy/i);
  });

  it("base kody prompt disambiguates dispatch from 'implement this' and enumerates the full read-tool catalog", async () => {
    // Regression: model sometimes called kody_run_issue in response to
    // "implement X" (a request for change, not a dispatch ask). Tool
    // policy now spells out the disambiguation. Also: hard rule #3's
    // read-tools list now covers the 4 discovery tools that were missing.
    const { AGENT_KODY } = await import("../../src/dashboard/lib/agents");
    const prompt = AGENT_KODY.systemPrompt;
    expect(prompt).toMatch(/Disambiguate dispatch vs\. create-issue/i);
    expect(prompt).toMatch(/implement this/i);
    expect(prompt).toMatch(/requests for change/i);
    expect(prompt).toMatch(/do NOT auto-dispatch/i);
    expect(prompt).toContain("github_get_pull_request_files");
    expect(prompt).toContain("github_list_branches");
    expect(prompt).toContain("github_get_commit");
    expect(prompt).toContain("github_get_tree");
  });

  it("base kody prompt memory section: full tool list, write freely during bootstrap", async () => {
    // Regression: memory section used to only mention `recall`, and the
    // bootstrap rule ("wait until 5+ memories exist") prevented growth.
    // Section now lists all 5 memory tools and inverts the bootstrap.
    const { AGENT_KODY } = await import("../../src/dashboard/lib/agents");
    const prompt = AGENT_KODY.systemPrompt;
    expect(prompt).toMatch(/recall_search/);
    expect(prompt).toMatch(/list_memories/);
    expect(prompt).toMatch(/update_memory/);
    expect(prompt).toMatch(/Write freely during the first few turns/i);
    expect(prompt).not.toMatch(
      /until 5\+ memories exist, write only on explicit ask/i,
    );
  });

  it("DEFAULT_MAX_STEPS is 100 (optimized for deep analysis)", () => {
    // Regression: cap used to be 10 (default) / 30 (goal-planner). The
    // prompt's "no fixed budget" rule needs a generous ceiling to mean
    // anything. 100 covers real research loops; maxDuration still bounds
    // wall-clock.
    expect(DEFAULT_MAX_STEPS).toBe(100);
  });
});
