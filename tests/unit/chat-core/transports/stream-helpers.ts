/**
 * @fileoverview Shared fetch/stream fixtures for the transport adapter
 * specs: build SSE Response objects from string chunks and install a
 * scripted global fetch.
 */

import { vi } from "vitest";
import type { ChatEvent } from "@dashboard/lib/chat/core/transports/transport-types";

/** A Response whose body streams the given chunks then closes. */
export function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

/**
 * A Response whose body delivers the prefix chunks, then errors with an
 * AbortError on the next read (pull-based — erroring inside start() would
 * discard the queued chunks before the reader sees them).
 */
export function abortingResponse(prefixChunks: string[] = []): Response {
  const enc = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < prefixChunks.length) {
        controller.enqueue(enc.encode(prefixChunks[index]));
        index++;
        return;
      }
      const abortError = new Error("The operation was aborted.");
      abortError.name = "AbortError";
      controller.error(abortError);
    },
  });
  return new Response(stream, { status: 200 });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface RecordedFetchCall {
  url: string;
  init: RequestInit | undefined;
  body: Record<string, unknown> | null;
}

/**
 * Install a scripted global fetch: each call shifts the next response
 * (factory, so streams are fresh). Returns the recorded calls.
 */
export function installScriptedFetch(
  responses: Array<() => Response | Promise<Response>>,
): { calls: RecordedFetchCall[]; restore: () => void } {
  const calls: RecordedFetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(
    async (url: RequestInfo | URL, init?: RequestInit) => {
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body) as Record<string, unknown>;
        } catch {
          body = null;
        }
      }
      calls.push({ url: String(url), init, body });
      const next = responses.shift();
      if (!next) throw new Error("scripted fetch exhausted");
      return next();
    },
  ) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Collect emitted ChatEvents into an array sink. */
export function eventSink(): {
  events: ChatEvent[];
  emit: (e: ChatEvent) => void;
} {
  const events: ChatEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}
