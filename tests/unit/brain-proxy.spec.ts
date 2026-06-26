/**
 * Tests for the shared Brain proxy helpers — preamble builders and the
 * SSE translation in streamBrainChat.
 *
 * fetch is stubbed; we feed canned Brain SSE chunks into a ReadableStream
 * and assert the dashboard-shaped events that come out the other side.
 * Issue-attachments dependency is mocked to keep the tests focused on
 * proxy behavior.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@dashboard/lib/issue-attachments", () => ({
  fetchIssueAttachments: vi.fn(async () => []),
}));

import {
  buildDecoratedMessage,
  formatCapabilityContext,
  formatTaskContext,
  streamBrainChat,
} from "@dashboard/lib/brain-proxy";

// ────────────────────────────────────────────────────────────────────────────
// Preamble builders
// ────────────────────────────────────────────────────────────────────────────

describe("formatTaskContext", () => {
  it("returns null when no issueNumber", () => {
    expect(formatTaskContext(undefined)).toBeNull();
    expect(formatTaskContext({})).toBeNull();
  });

  it("renders an issue with title, state, labels, and column", () => {
    const out = formatTaskContext({
      issueNumber: 42,
      title: "Fix the thing",
      state: "open",
      column: "Doing",
      labels: ["bug", "priority:high"],
    });
    expect(out).toContain("#42 — Fix the thing");
    expect(out).toContain("State: open");
    expect(out).toContain("Column: Doing");
    expect(out).toContain("bug, priority:high");
  });

  it("truncates long descriptions to 1500 chars with ellipsis", () => {
    const body = "x".repeat(2000);
    const out = formatTaskContext({ issueNumber: 1, body })!;
    expect(out).toContain(`${"x".repeat(1500)}…`);
    expect(out).not.toContain("x".repeat(1501));
  });

  it("renders the associated PR with state + url when present", () => {
    const out = formatTaskContext({
      issueNumber: 1,
      associatedPR: {
        number: 9,
        state: "open",
        html_url: "https://github.com/x/y/pull/9",
      },
    })!;
    expect(out).toContain("PR: #9 (open) — https://github.com/x/y/pull/9");
  });
});

describe("formatCapabilityContext", () => {
  it("returns null when number is missing", () => {
    expect(formatCapabilityContext(undefined)).toBeNull();
    expect(formatCapabilityContext({ title: "no number" })).toBeNull();
  });

  it("renders a capability with title, state, labels, and body", () => {
    const out = formatCapabilityContext({
      number: 7,
      title: "Weekly cleanup",
      state: "open",
      labels: ["kody:capability"],
      body: "Body text.",
    })!;
    expect(out).toContain("#7 — Weekly cleanup");
    expect(out).toContain("State: open");
    expect(out).toContain("kody:capability");
    expect(out).toContain("[Capability body]\nBody text.");
    expect(out).toContain("grounded in the body above");
  });
});

describe("buildDecoratedMessage", () => {
  it("returns the bare message when no context is present", () => {
    expect(buildDecoratedMessage("hi", {})).toBe("hi");
  });

  it("combines capability + task preambles in the documented order", () => {
    const out = buildDecoratedMessage("user text", {
      capabilityContext: { number: 1, title: "J" },
      taskContext: { issueNumber: 2, title: "T" },
    });
    const jobIdx = out.indexOf("[Current capability]");
    const taskIdx = out.indexOf("[Current task context]");
    const userIdx = out.indexOf("[User]\nuser text");
    expect(jobIdx).toBeGreaterThan(-1);
    expect(taskIdx).toBeGreaterThan(jobIdx);
    expect(userIdx).toBeGreaterThan(taskIdx);
  });

  it("omits the plain-language preamble unless plainLanguage is set", () => {
    expect(buildDecoratedMessage("hi", {})).not.toContain("[Answer style]");
    expect(buildDecoratedMessage("hi", { plainLanguage: false })).not.toContain(
      "[Answer style]",
    );
  });

  it("appends the plain-language preamble LAST (after context, before user)", () => {
    const out = buildDecoratedMessage("user text", {
      taskContext: { issueNumber: 2, title: "T" },
      plainLanguage: true,
    });
    const taskIdx = out.indexOf("[Current task context]");
    const styleIdx = out.indexOf("[Answer style]");
    const userIdx = out.indexOf("[User]\nuser text");
    expect(styleIdx).toBeGreaterThan(taskIdx);
    expect(userIdx).toBeGreaterThan(styleIdx);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// streamBrainChat — SSE translation against a stubbed upstream
// ────────────────────────────────────────────────────────────────────────────

interface FakeUpstreamOpts {
  status?: number;
  events?: Array<Record<string, unknown> | string>;
  /** Throw on fetch (simulates network failure). */
  throwError?: boolean;
}

function installFetchStub(opts: FakeUpstreamOpts): {
  calls: Array<{ url: string; init: RequestInit | undefined }>;
  restore: () => void;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (opts.throwError) throw new Error("network down");
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const ev of opts.events ?? []) {
            const line =
              typeof ev === "string" ? ev : `data: ${JSON.stringify(ev)}\n\n`;
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        },
      });
      const status = opts.status ?? 200;
      return new Response(
        status >= 200 && status < 300 ? stream : "upstream error",
        {
          status,
          headers: { "content-type": "text/event-stream" },
        },
      );
    }),
  );
  return {
    calls,
    restore: () => vi.unstubAllGlobals(),
  };
}

async function readSseEvents(res: Response): Promise<
  Array<{
    type: string;
    content?: string;
    error?: string;
    name?: string;
    role?: string;
    seq?: number;
  }>
> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  for (const line of buf.split("\n")) {
    if (line.startsWith("data: ")) {
      events.push(JSON.parse(line.slice(6)));
    }
  }
  return events as Array<{
    type: string;
    content?: string;
    error?: string;
    name?: string;
    role?: string;
  }>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamBrainChat — SSE translation", () => {
  it("forwards POST to {brainUrl}/chats/{chatId}/messages with X-Api-Key + body", async () => {
    const { calls } = installFetchStub({ events: [{ type: "done" }] });
    await streamBrainChat({
      brainUrl: "https://brain.example.com",
      brainKey: "k123",
      chatId: "c1",
      message: "hi",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://brain.example.com/chats/c1/messages");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("k123");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(calls[0]!.init!.body as string) as {
      message: string;
    };
    expect(body.message).toBe("hi");
  });

  it("strips trailing slashes from brainUrl", async () => {
    const { calls } = installFetchStub({ events: [{ type: "done" }] });
    await streamBrainChat({
      brainUrl: "https://brain.example.com////",
      brainKey: "k",
      chatId: "c1",
      message: "hi",
    });
    expect(calls[0]!.url).toBe("https://brain.example.com/chats/c1/messages");
  });

  it("forwards repo when provided", async () => {
    const { calls } = installFetchStub({ events: [{ type: "done" }] });
    await streamBrainChat({
      brainUrl: "https://b.example.com",
      brainKey: "k",
      chatId: "c1",
      message: "hi",
      repo: "alice/widgets",
    });
    const body = JSON.parse(calls[0]!.init!.body as string) as {
      repo?: string;
    };
    expect(body.repo).toBe("alice/widgets");
  });

  it("returns 502 JSON when fetch throws", async () => {
    installFetchStub({ throwError: true });
    const res = await streamBrainChat({
      brainUrl: "https://b.example.com",
      brainKey: "k",
      chatId: "c1",
      message: "hi",
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/unreachable/i);
  });

  it("returns 502 JSON when upstream returns non-2xx", async () => {
    installFetchStub({ status: 503, events: [] });
    const res = await streamBrainChat({
      brainUrl: "https://b.example.com",
      brainKey: "k",
      chatId: "c1",
      message: "hi",
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/503/);
  });

  it("translates upstream text events into accumulated chat.message events", async () => {
    installFetchStub({
      events: [
        { type: "chat", chatId: "c1" },
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
        { type: "done" },
      ],
    });
    const res = await streamBrainChat({
      brainUrl: "https://b.example.com",
      brainKey: "k",
      chatId: "c1",
      message: "hi",
    });
    const events = await readSseEvents(res);
    const messageEvents = events.filter((e) => e.type === "chat.message");
    expect(messageEvents.map((e) => e.content)).toEqual([
      "Hello ",
      "Hello world",
    ]);
    expect(messageEvents.every((e) => e.role === "assistant")).toBe(true);
    // Every translated event now carries a `seq` cursor (0 here — the stub
    // sends no seq, so lastSeq never advances).
    expect(events[events.length - 1]).toMatchObject({ type: "chat.done" });
  });

  it("translates tool_use into chat.tool_use with name + input", async () => {
    installFetchStub({
      events: [
        { type: "tool_use", name: "Grep", input: { pattern: "foo" } },
        { type: "done" },
      ],
    });
    const events = await readSseEvents(
      await streamBrainChat({
        brainUrl: "https://b.example.com",
        brainKey: "k",
        chatId: "c1",
        message: "hi",
      }),
    );
    const tool = events.find((e) => e.type === "chat.tool_use");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("Grep");
  });

  it("translates upstream error events into chat.error", async () => {
    installFetchStub({
      events: [
        { type: "chat", chatId: "c1" },
        { type: "error", error: "agent kaboom" },
      ],
    });
    const events = await readSseEvents(
      await streamBrainChat({
        brainUrl: "https://b.example.com",
        brainKey: "k",
        chatId: "c1",
        message: "hi",
      }),
    );
    expect(events[events.length - 1]).toMatchObject({
      type: "chat.error",
      error: "agent kaboom",
    });
  });

  it("skips the empty handshake event (no chat.message emitted for type: chat)", async () => {
    installFetchStub({
      events: [{ type: "chat", chatId: "c1" }, { type: "done" }],
    });
    const events = await readSseEvents(
      await streamBrainChat({
        brainUrl: "https://b.example.com",
        brainKey: "k",
        chatId: "c1",
        message: "hi",
      }),
    );
    expect(events.find((e) => e.type === "chat.message")).toBeUndefined();
  });

  it("decorates the outgoing message with task + job preambles", async () => {
    const { calls } = installFetchStub({ events: [{ type: "done" }] });
    await streamBrainChat({
      brainUrl: "https://b.example.com",
      brainKey: "k",
      chatId: "c1",
      message: "user message",
      taskContext: { issueNumber: 42, title: "Fix it" },
      capabilityContext: { number: 7, title: "Daily report" },
    });
    const body = JSON.parse(calls[0]!.init!.body as string) as {
      message: string;
    };
    expect(body.message).toContain("[Current task context]");
    expect(body.message).toContain("[Current capability]");
    expect(body.message).toContain("[User]\nuser message");
  });

  it("omits attachments + repo when not supplied (clean wire shape)", async () => {
    const { calls } = installFetchStub({ events: [{ type: "done" }] });
    await streamBrainChat({
      brainUrl: "https://b.example.com",
      brainKey: "k",
      chatId: "c1",
      message: "hi",
    });
    const body = JSON.parse(calls[0]!.init!.body as string) as Record<
      string,
      unknown
    >;
    expect(body.attachments).toBeUndefined();
    expect(body.repo).toBeUndefined();
  });

  it("propagates the upstream seq onto every translated event", async () => {
    installFetchStub({
      events: [
        { type: "text", text: "hi", seq: 4 },
        { type: "done", seq: 5 },
      ],
    });
    const events = await readSseEvents(
      await streamBrainChat({
        brainUrl: "https://b.example.com",
        brainKey: "k",
        chatId: "c1",
        message: "hi",
      }),
    );
    const msg = events.find((e) => e.type === "chat.message");
    const done = events.find((e) => e.type === "chat.done");
    expect(msg!.seq).toBe(4);
    expect(done!.seq).toBe(5);
  });

  it("emits chat.reconnect when upstream closes without a terminal event", async () => {
    installFetchStub({
      events: [{ type: "text", text: "partial", seq: 9 }],
    });
    const events = await readSseEvents(
      await streamBrainChat({
        brainUrl: "https://b.example.com",
        brainKey: "k",
        chatId: "c1",
        message: "hi",
      }),
    );
    const last = events[events.length - 1];
    expect(last.type).toBe("chat.reconnect");
    // Cursor carried so the client reconnects from the last seen event.
    expect(last.seq).toBe(9);
  });

  it("resume mode GETs /chats/:id/stream?since=N with no body", async () => {
    const { calls } = installFetchStub({ events: [{ type: "done", seq: 8 }] });
    await streamBrainChat({
      brainUrl: "https://b.example.com",
      brainKey: "k",
      chatId: "c1",
      message: "",
      resumeSince: 7,
    });
    expect(calls[0]!.url).toBe("https://b.example.com/chats/c1/stream?since=7");
    expect(calls[0]!.init!.method).toBe("GET");
    expect(calls[0]!.init!.body).toBeUndefined();
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("k");
  });

  it("resume seeds the cumulative buffer with resumeText so the reply isn't truncated", async () => {
    installFetchStub({
      events: [
        { type: "text", text: " world", seq: 3 },
        { type: "done", seq: 4 },
      ],
    });
    const events = await readSseEvents(
      await streamBrainChat({
        brainUrl: "https://b.example.com",
        brainKey: "k",
        chatId: "c1",
        message: "",
        resumeSince: 2,
        resumeText: "Hello",
      }),
    );
    const msg = events.find((e) => e.type === "chat.message");
    // Continues from what the client already showed, not just the tail.
    expect(msg!.content).toBe("Hello world");
  });

  it("resume reports a non-regressing cursor when no new events arrive", async () => {
    installFetchStub({ events: [] });
    const events = await readSseEvents(
      await streamBrainChat({
        brainUrl: "https://b.example.com",
        brainKey: "k",
        chatId: "c1",
        message: "",
        resumeSince: 12,
      }),
    );
    const last = events[events.length - 1];
    expect(last.type).toBe("chat.reconnect");
    expect(last.seq).toBe(12);
  });

  it("does not trip the idle timeout while a tool is in flight", async () => {
    // Regression: a long-running Brain tool (multi-minute build / test / git
    // op) used to surface as a `chat.reconnect` at 120s of silence, breaking
    // long tasks. The proxy now widens its idle window to 10 min for the
    // duration of an in-flight tool_use.
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let upstreamController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                upstreamController = controller;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "tool_use", name: "Bash", input: { cmd: "sleep 1" } })}\n\n`,
                  ),
                );
              },
            }),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          );
        }),
      );

      const res = await streamBrainChat({
        brainUrl: "https://b.example.com",
        brainKey: "k",
        chatId: "c1",
        message: "hi",
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      // Read the first translated event — must be chat.tool_use, proving
      // the proxy is alive and processing.
      const first = await reader.read();
      expect(first.done).toBe(false);
      const firstText = decoder.decode(first.value, { stream: true });
      expect(firstText).toContain("chat.tool_use");

      // Drain any remaining bytes in the first chunk, then watch the rest.
      let tail = firstText.split("\n").pop() ?? "";
      let reconnectSeen: unknown = null;
      let streamDone = false;
      const consume = (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            streamDone = true;
            return;
          }
          tail += decoder.decode(value, { stream: true });
          const lines = tail.split("\n");
          tail = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "chat.reconnect") reconnectSeen = ev;
            }
          }
        }
      })();

      // Advance past the previous default (120s) but well under the new
      // during-tool budget (600s). The proxy must NOT emit chat.reconnect
      // and must NOT close the stream — the stream is still open because
      // Brain is "running the tool".
      await vi.advanceTimersByTimeAsync(130_000);
      await Promise.resolve();
      await Promise.resolve();
      expect(reconnectSeen).toBeNull();
      expect(streamDone).toBe(false);

      // Close the upstream cleanly. The proxy should now emit chat.reconnect
      // (no terminal event was ever sent) and close the translated stream.
      upstreamController!.close();
      await consume;
      expect(reconnectSeen).toMatchObject({ type: "chat.reconnect" });
    } finally {
      vi.useRealTimers();
    }
  });
});
