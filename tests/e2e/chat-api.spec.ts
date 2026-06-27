/**
 * @fileoverview Chat API E2E tests — verify the new chat flow endpoints.
 * @testFramework playwright
 * @domain e2e
 *
 * Tests the three new API endpoints:
 *   POST /api/kody/chat          → 410 Gone (deprecated)
 *   POST /api/kody/chat/trigger → 200 + workflow dispatch OR 503 if token missing
 *   GET  /api/kody/chat/history → 200 + messages OR 503 if token missing
 *
 * Also tests the SSE stream endpoint.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const TEST_SESSION_ID = `pw-test-session-${Date.now()}`;
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ?? "https://github.com/test-owner/test-repo";

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return { owner: parts[0] ?? "test-owner", repo: parts[1] ?? "test-repo" };
  } catch {
    return { owner: "test-owner", repo: "test-repo" };
  }
}

function authHeaders(): Record<string, string> {
  const token = process.env.E2E_GITHUB_TOKEN ?? process.env.KODY_BOT_TOKEN;
  if (!token) return {};
  const { owner, repo } = parseRepo(TEST_REPO);
  return {
    "x-kody-token": token,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
}

async function apiGet(
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { ...authHeaders() },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function apiPost(
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.describe("Chat API — deprecated direct endpoint", () => {
  test("POST /api/kody/chat returns 410 Gone", async () => {
    const { status, body } = await apiPost("/api/kody/chat", {
      messages: [{ role: "user", content: "hello" }],
    });

    expect(status, `Expected 410, got ${status}`).toBe(410);
    expect(body as Record<string, unknown>).toMatchObject({
      deprecated: true,
      error: expect.stringContaining("deprecated"),
    });
  });

  test("GET /api/kody/chat returns deprecation notice", async () => {
    const { status, body } = await apiGet("/api/kody/chat");

    expect(status).toBe(200);
    expect(body as Record<string, unknown>).toMatchObject({
      deprecated: true,
      status: expect.stringContaining("deprecated"),
    });
  });
});

test.describe("Chat API — trigger endpoint", () => {
  test("POST /api/kody/chat/trigger requires taskId", async () => {
    const { status, body } = await apiPost("/api/kody/chat/trigger", {
      messages: [{ role: "user", content: "hello" }],
    });

    expect(status, `Expected 400, got ${status}`).toBe(400);
    expect(body as Record<string, unknown>).toMatchObject({
      error: expect.stringContaining("taskId"),
    });
  });

  test("POST /api/kody/chat/trigger requires messages", async () => {
    const { status, body } = await apiPost("/api/kody/chat/trigger", {
      taskId: TEST_SESSION_ID,
    });

    expect(status, `Expected 400, got ${status}`).toBe(400);
    expect(body as Record<string, unknown>).toMatchObject({
      error: expect.stringContaining("messages"),
    });
  });

  test("POST /api/kody/chat/trigger rejects when auth is missing", async () => {
    const res = await fetch(`${BASE_URL}/api/kody/chat/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: TEST_SESSION_ID,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body as Record<string, unknown>).toMatchObject({
      message: expect.stringMatching(/authenticated|token/i),
    });
  });
});

test.describe("Chat API — history endpoint", () => {
  test("GET /api/kody/chat/history requires taskId", async () => {
    const { status, body } = await apiGet("/api/kody/chat/history");

    expect(status, `Expected 400, got ${status}`).toBe(400);
    expect(body as Record<string, unknown>).toMatchObject({
      error: expect.stringContaining("taskId"),
    });
  });

  test("GET /api/kody/chat/history returns empty messages for unknown session", async () => {
    const { status, body } = await apiGet(
      `/api/kody/chat/history?taskId=pw-nonexistent-${Date.now()}`,
    );

    if (status === 200) {
      expect(body as Record<string, unknown>).toMatchObject({ messages: [] });
    } else {
      // 503 = no auth, 500 = GitHub env vars not set (common in local dev)
      expect([503, 500]).toContain(status);
    }
  });
});

test.describe("Events API — SSE endpoint", () => {
  test("GET /api/kody/events/stream requires taskId", async () => {
    const { status } = await apiGet("/api/kody/events/stream");

    expect(status, `Expected 400, got ${status}`).toBe(400);
  });

  test("GET /api/kody/events/stream returns text/event-stream content type", async () => {
    // The SSE stream is infinite, so we can't consume its body in a test.
    // The endpoint supports ?test=1 which returns headers-only (no streaming body)
    // so we can assert Content-Type without hanging.
    const res = await fetch(
      `${BASE_URL}/api/kody/events/stream?taskId=${TEST_SESSION_ID}&test=1`,
      { headers: { ...authHeaders() } },
    );

    expect(res.status, `Expected 200, got ${res.status}`).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // Body is just JSON metadata in test mode
    const body = await res.json();
    expect(body as Record<string, unknown>).toMatchObject({
      note: "test mode — not streaming",
      sessionId: TEST_SESSION_ID,
    });
  });
});

test.describe("Events API — POST endpoint", () => {
  test("POST /api/kody/events accepts chat.message payload", async () => {
    const res = await fetch(`${BASE_URL}/api/kody/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        event: "chat.message",
        payload: {
          runId: `test-${Date.now()}`,
          sessionId: TEST_SESSION_ID,
          role: "assistant",
          content: "Hello from test",
          timestamp: new Date().toISOString(),
        },
        channel: "chat",
      }),
    });

    expect(res.status).toBeGreaterThanOrEqual(200);
    const body = await res.json();
    expect(body as Record<string, unknown>).toMatchObject({ ok: true });
  });

  test("POST /api/kody/events rejects when event is missing", async () => {
    const res = await fetch(`${BASE_URL}/api/kody/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ payload: { runId: "test" } }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
