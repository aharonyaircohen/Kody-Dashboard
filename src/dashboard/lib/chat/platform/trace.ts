/**
 * @fileType module
 * @domain chat-platform
 * @pattern client-trace-ring
 * @ai-summary Unified client tracing for the chat platform (phase 2 step 2).
 *   A tiny fixed-capacity ring buffer records mode/backend/plugin events
 *   (display-mode changes, transport send start/settle, plugin
 *   registration, host effects, panel open/close). Read it from the
 *   browser console via `window.__kodyChatTrace.read()` — nothing is ever
 *   logged; the buffer is inspection-only and all wire-in call sites are
 *   behavior-neutral (trace never throws).
 */

export interface ChatTraceEvent {
  kind: string;
  detail?: unknown;
}

export interface ChatTraceEntry extends ChatTraceEvent {
  /** Monotonic sequence number (never reused, survives eviction). */
  seq: number;
  /** Epoch millis at record time. */
  at: number;
}

export interface ChatTraceBuffer {
  trace(event: ChatTraceEvent): void;
  /** Oldest → newest snapshot (new array per call; entries are copies). */
  read(): ChatTraceEntry[];
  clear(): void;
}

export const CHAT_TRACE_CAPACITY = 200;

/** Pure factory — unit-testable without touching the module singleton. */
export function createChatTraceBuffer(
  capacity: number = CHAT_TRACE_CAPACITY,
): ChatTraceBuffer {
  const entries: ChatTraceEntry[] = [];
  let seq = 0;
  return {
    trace(event) {
      const entry: ChatTraceEntry = {
        kind: event.kind,
        ...(event.detail !== undefined ? { detail: event.detail } : {}),
        seq: seq++,
        at: Date.now(),
      };
      entries.push(entry);
      if (entries.length > capacity)
        entries.splice(0, entries.length - capacity);
    },
    read() {
      return entries.map((e) => ({ ...e }));
    },
    clear() {
      entries.length = 0;
    },
  };
}

const globalBuffer = createChatTraceBuffer();

/** Record one event into the shared client trace. Never throws. */
export function trace(event: ChatTraceEvent): void {
  try {
    globalBuffer.trace(event);
  } catch {
    // Tracing must never break the chat.
  }
}

/** Snapshot the shared trace (oldest → newest). */
export function readChatTrace(): ChatTraceEntry[] {
  return globalBuffer.read();
}

// Expose read-only inspection on window for debugging (guarded — SSR and
// node test runs have no window; no console output anywhere).
if (typeof window !== "undefined") {
  try {
    (window as unknown as Record<string, unknown>).__kodyChatTrace = {
      read: () => globalBuffer.read(),
      clear: () => globalBuffer.clear(),
    };
  } catch {
    // Non-fatal: tracing stays available in-module.
  }
}
