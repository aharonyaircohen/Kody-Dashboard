/**
 * @fileoverview Integration tests for /api/kody/chat/kody (Kody direct agent).
 * @testFramework vitest
 * @domain chat-contract
 *
 * Covers request validation + provider-key plumbing without hitting the
 * live Gemini API. The SDK call is not mocked end-to-end; we assert the
 * behaviour the UI depends on: 400 on bad input, 503 when the key is
 * missing, auth gate before doing any work.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST as kodyChatPOST } from "../../app/api/kody/chat/kody/route"

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
  })
}

beforeAll(() => {
  // Auth requires this even though it's not directly used for the LLM call.
  process.env.KODY_MASTER_KEY = "kody-direct-test-secret"
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("POST /api/kody/chat/kody", () => {
  it("returns 503 when GEMINI_API_KEY is not configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "")
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "")
    const res = await kodyChatPOST(makeRequest({ messages: [{ role: "user", content: "hi" }] }))
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(String(data.error)).toMatch(/GEMINI_API_KEY/)
  })

  it("returns 400 when messages are missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "dummy-key")
    const res = await kodyChatPOST(makeRequest({}))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(String(data.error)).toMatch(/messages required/)
  })

  it("returns 400 when messages array is empty", async () => {
    vi.stubEnv("GEMINI_API_KEY", "dummy-key")
    const res = await kodyChatPOST(makeRequest({ messages: [] }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when all messages have empty content (after filter)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "dummy-key")
    const res = await kodyChatPOST(
      makeRequest({ messages: [{ role: "user", content: "   " }, { role: "assistant", content: "" }] }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 401 when kody auth is missing (no headers, no bot token)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "dummy-key")
    vi.stubEnv("KODY_BOT_TOKEN", "")
    const req = new NextRequest("https://dash.test/api/kody/chat/kody", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    })
    const res = await kodyChatPOST(req)
    expect([401, 403]).toContain(res.status)
  })

  it("builds a system prompt that names the connected repo + task context", async () => {
    // We can't observe the system prompt the SDK sends without mocking the
    // provider, so we unit-test buildSystemPrompt by re-importing it.
    const { buildSystemPrompt } = await import("../../app/api/kody/chat/kody/system-prompt")
    const prompt = buildSystemPrompt(
      "You are Kody.",
      { owner: "acme", repo: "widgets" },
      {
        issueNumber: 42,
        title: "Add dark mode",
        state: "open",
        labels: ["ui", "good-first-issue"],
        associatedPR: { number: 101, state: "open", html_url: "https://github.com/acme/widgets/pull/101" },
      },
    )
    expect(prompt).toContain("acme/widgets")
    expect(prompt).toContain("Issue #42")
    expect(prompt).toContain("Add dark mode")
    expect(prompt).toContain("ui, good-first-issue")
    expect(prompt).toContain("Associated PR: #101")
  })

  it("builds a repo-less prompt when no auth headers are present", async () => {
    const { buildSystemPrompt } = await import("../../app/api/kody/chat/kody/system-prompt")
    const prompt = buildSystemPrompt("base", null, undefined)
    expect(prompt).toBe("base")
  })

  it("appends a job-drafting block when opts.jobDraft is set", async () => {
    const { buildSystemPrompt } = await import("../../app/api/kody/chat/kody/system-prompt")
    const prompt = buildSystemPrompt("base", null, undefined, { jobDraft: true })
    expect(prompt).toContain("Job drafting mode")
    expect(prompt).toContain("drafting a new Kody job")
    expect(prompt).toContain("Use as job")
  })

  it("omits the job-drafting block by default", async () => {
    const { buildSystemPrompt } = await import("../../app/api/kody/chat/kody/system-prompt")
    const prompt = buildSystemPrompt("base", null, undefined)
    expect(prompt).not.toContain("Job drafting mode")
  })

  it("appends a current-job block when opts.job is set", async () => {
    const { buildSystemPrompt } = await import("../../app/api/kody/chat/kody/system-prompt")
    const prompt = buildSystemPrompt("base", null, undefined, {
      job: {
        number: 7,
        title: "Auto-triage stale issues",
        body: "## Intent\nClose stale issues",
        state: "open",
        labels: ["kody:job"],
      },
    })
    expect(prompt).toContain("Current job")
    expect(prompt).toContain("Job #7")
    expect(prompt).toContain("Auto-triage stale issues")
    expect(prompt).toContain("Close stale issues")
    expect(prompt).toContain("kody:job")
  })
})
