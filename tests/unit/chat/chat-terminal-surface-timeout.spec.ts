/**
 * @fileoverview Source-level regression guard for Kody Chat terminal I/O.
 * @testFramework vitest
 * @domain terminal
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../../src/dashboard/lib/components/ChatTerminalSurface.tsx",
  ),
  "utf8",
);

describe("ChatTerminalSurface timeout guard", () => {
  it("bounds terminal input and output fetches so one stuck request cannot freeze polling", () => {
    expect(SOURCE).toContain("function fetchWithTimeout(");
    expect(SOURCE).toContain("TERMINAL_RESIZE_TIMEOUT_MS");
    expect(SOURCE).toContain("TERMINAL_INPUT_TIMEOUT_MS");
    expect(SOURCE).toContain("TERMINAL_STOP_TIMEOUT_MS");
    expect(SOURCE).toContain("TERMINAL_START_TIMEOUT_MS");
    expect(SOURCE).toContain("LOCAL_POLL_TIMEOUT_MS");
    expect(SOURCE).toContain("FLY_CONNECT_TIMEOUT_MS");
    expect(SOURCE).toContain(
      'fetchWithTimeout(\n      "/api/kody/chat/terminal/resize"',
    );
    expect(SOURCE).toContain(
      'fetchWithTimeout(\n      "/api/kody/chat/terminal/input"',
    );
    expect(SOURCE).toContain(
      'fetchWithTimeout(\n        "/api/kody/chat/terminal/start"',
    );
    expect(SOURCE).toContain(
      'fetchWithTimeout(\n          "/api/kody/terminal/session"',
    );
    expect(SOURCE).toContain(
      "fetchWithTimeout(\n        `/api/kody/chat/terminal/output?${params}`",
    );
    expect(SOURCE).toContain(
      'fetchWithTimeout(\n        "/api/kody/chat/terminal/stop"',
    );
    expect(SOURCE).toContain("pollBusyRef.current = false");
  });

  it("guards Fly socket writes so stale connect attempts cannot duplicate terminal output", () => {
    expect(SOURCE).toContain("flyConnectSeqRef");
    expect(SOURCE).toContain("flyConnectInFlightKeyRef");
    expect(SOURCE).toContain("isCurrentFlyConnect");
    expect(SOURCE).toContain("flySocketRef.current !== ws");
  });
});
