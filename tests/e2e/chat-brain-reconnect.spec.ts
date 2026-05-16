/**
 * @fileoverview Brain reconnect E2E — proves a Brain reply survives a
 * mid-stream disconnect (the real-world symptom: Vercel hard-kills the proxy
 * function at ~300s, truncating long replies).
 * @testFramework playwright
 * @domain e2e
 *
 * Strategy (no 300s wait needed): start a Brain turn, read the SSE until the
 * reply is visibly in progress, then *abort the connection mid-stream* to
 * simulate the Vercel kill. Reconnect with `resumeSince` + `resumeText` and
 * assert the turn (a) was still running server-side, (b) replays/continues
 * past the cut, and (c) finishes (`chat.done`) without truncating what was
 * already shown.
 *
 * Gated by RUN_REAL_E2E=1 — hits the real deployed dashboard + Brain server.
 * Required env (auto-loaded from .env by playwright.config):
 *   BASE_URL              deployed dashboard URL
 *   E2E_GITHUB_TOKEN      PAT (sent as x-kody-token)
 *   E2E_GITHUB_REPO       https://github.com/<owner>/<repo>
 *   BRAIN_CHAT_URL        Brain server URL  (sent as x-brain-url)
 *   BRAIN_CHAT_API_KEY    Brain server key  (sent as x-brain-key)
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "";
const TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const REPO = process.env.E2E_GITHUB_REPO ?? "";
const BRAIN_URL = process.env.BRAIN_CHAT_URL ?? "";
const BRAIN_KEY = process.env.BRAIN_CHAT_API_KEY ?? "";
const RUN_REAL = process.env.RUN_REAL_E2E === "1";

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const parts = new URL(url).pathname
      .replace(/^\//, "")
      .split("/")
      .filter(Boolean);
    return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
  } catch {
    return { owner: "", repo: "" };
  }
}

function headers(): Record<string, string> {
  const { owner, repo } = parseRepo(REPO);
  return {
    "Content-Type": "application/json",
    "x-kody-token": TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
    "x-brain-url": BRAIN_URL,
    "x-brain-key": BRAIN_KEY,
  };
}

interface DashEvent {
  type?: string;
  content?: string;
  error?: string;
  seq?: number;
}

/**
 * Read the SSE body, invoking `onEvent` per parsed event. Resolves with the
 * collected events when the stream ends or `stopWhen` returns true (after
 * which the reader is cancelled — that's our simulated disconnect).
 */
async function readStream(
  res: Response,
  stopWhen?: (ev: DashEvent, all: DashEvent[]) => boolean,
): Promise<DashEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: DashEvent[] = [];
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const nl = buf.lastIndexOf("\n");
    if (nl === -1) continue;
    const chunk = buf.slice(0, nl + 1);
    buf = buf.slice(nl + 1);
    let stop = false;
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      let ev: DashEvent;
      try {
        ev = JSON.parse(raw) as DashEvent;
      } catch {
        continue;
      }
      events.push(ev);
      if (stopWhen?.(ev, events)) stop = true;
    }
    if (stop) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return events;
}

test.describe("Brain reconnect @real", () => {
  test.skip(!RUN_REAL, "set RUN_REAL_E2E=1 to enable");

  test("a reply survives a mid-stream disconnect and resumes without truncation", async () => {
    test.skip(
      !BASE_URL || !TOKEN || !REPO || !BRAIN_URL || !BRAIN_KEY,
      "BASE_URL / E2E_GITHUB_TOKEN / E2E_GITHUB_REPO / BRAIN_CHAT_URL / BRAIN_CHAT_API_KEY required",
    );
    test.setTimeout(240_000);

    const chatId = `pw-reconnect-${Date.now()}`;
    const h = headers();

    // ── Phase 1: start the turn, then sever the connection mid-reply ──
    // A prompt that streams over several seconds so we can reliably catch it
    // in flight (the reply must still be running when we disconnect).
    const startRes = await fetch(`${BASE_URL}/api/kody/chat/brain`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        chatId,
        message:
          "Output the numbers 1 through 30, each on its own line, prefixed with 'LINE '. After the list, on a new line, write exactly: DONE-MARKER-7714.",
      }),
    });
    expect(
      startRes.ok,
      `start failed: HTTP ${startRes.status} ${await startRes
        .clone()
        .text()
        .catch(() => "")}`,
    ).toBeTruthy();

    let cutSeq = 0;
    let cutText = "";
    let sawDoneBeforeCut = false;
    const phase1 = await readStream(startRes, (ev, all) => {
      if (ev.type === "chat.done" || ev.type === "chat.error") {
        sawDoneBeforeCut = true;
        return true; // reply finished before we could cut — handled below
      }
      // Cut once we have a real partial assistant message with a cursor.
      const msgs = all.filter((e) => e.type === "chat.message");
      if (
        ev.type === "chat.message" &&
        typeof ev.seq === "number" &&
        ev.seq > 0 &&
        (ev.content?.length ?? 0) > 0 &&
        msgs.length >= 1
      ) {
        cutSeq = ev.seq ?? 0;
        cutText = ev.content ?? "";
        return true;
      }
      return false;
    });

    // Track the highest seq actually seen at the cut.
    for (const e of phase1) {
      if (typeof e.seq === "number" && e.seq > cutSeq) cutSeq = e.seq;
    }

    // If Brain finished before we could sever, the reconnect path isn't
    // exercised — fail loudly rather than passing vacuously.
    expect(
      sawDoneBeforeCut,
      "reply completed before we could disconnect — increase the prompt length",
    ).toBeFalsy();
    expect(cutSeq, "expected a positive cursor at the cut").toBeGreaterThan(0);
    expect(cutText.length, "expected partial text at the cut").toBeGreaterThan(
      0,
    );

    // ── Phase 2: reconnect from the cursor, read to completion ──
    const resumeRes = await fetch(`${BASE_URL}/api/kody/chat/brain`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        chatId,
        resumeSince: cutSeq,
        resumeText: cutText,
      }),
    });
    expect(
      resumeRes.ok,
      `resume failed: HTTP ${resumeRes.status}`,
    ).toBeTruthy();

    // Follow reconnect sentinels too: a long turn can hand off more than once.
    let events = await readStream(resumeRes);
    let guard = 0;
    while (
      !events.some((e) => e.type === "chat.done" || e.type === "chat.error") &&
      events.some((e) => e.type === "chat.reconnect") &&
      guard++ < 10
    ) {
      let lastSeq = cutSeq;
      let lastText = cutText;
      for (const e of events) {
        if (typeof e.seq === "number" && e.seq > lastSeq) lastSeq = e.seq;
        if (e.type === "chat.message" && typeof e.content === "string") {
          lastText = e.content;
        }
      }
      const again = await fetch(`${BASE_URL}/api/kody/chat/brain`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          chatId,
          resumeSince: lastSeq,
          resumeText: lastText,
        }),
      });
      expect(again.ok, `re-resume failed: HTTP ${again.status}`).toBeTruthy();
      events = await readStream(again);
    }

    // The turn survived the disconnect and finished cleanly.
    const errored = events.find((e) => e.type === "chat.error");
    expect(
      errored,
      `resumed stream errored: ${errored?.error ?? ""}`,
    ).toBeUndefined();
    expect(
      events.some((e) => e.type === "chat.done"),
      "resumed stream never reached chat.done",
    ).toBeTruthy();

    // No truncation: the final assistant text continues from what we already
    // had at the cut, and the reply actually completed (end marker present).
    const finalMsg = [...events]
      .reverse()
      .find((e) => e.type === "chat.message" && e.content);
    expect(finalMsg, "no assistant message after resume").toBeTruthy();
    const finalText = finalMsg!.content ?? "";
    expect(
      finalText.startsWith(cutText.slice(0, Math.min(cutText.length, 12))),
      "resumed reply did not continue from the pre-cut text (truncated)",
    ).toBeTruthy();
    expect(
      finalText.length,
      "resumed reply is not longer than the pre-cut text",
    ).toBeGreaterThan(cutText.length);
    expect(
      finalText.includes("DONE-MARKER-7714"),
      "resumed reply is missing the end marker — turn did not complete",
    ).toBeTruthy();
  });
});
