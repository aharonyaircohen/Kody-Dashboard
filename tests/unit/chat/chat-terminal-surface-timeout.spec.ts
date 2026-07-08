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
  it("bounds terminal input and output fetches so one stuck request cannot freeze output reads", () => {
    expect(SOURCE).toContain("function fetchWithTimeout(");
    expect(SOURCE).toContain("TERMINAL_RESIZE_TIMEOUT_MS");
    expect(SOURCE).toContain("TERMINAL_INPUT_TIMEOUT_MS");
    expect(SOURCE).toContain("TERMINAL_STOP_TIMEOUT_MS");
    expect(SOURCE).toContain("TERMINAL_START_TIMEOUT_MS");
    expect(SOURCE).toContain("LOCAL_OUTPUT_READ_TIMEOUT_MS");
    expect(SOURCE).toContain("LOCAL_OUTPUT_WAIT_MS");
    expect(SOURCE).toContain("FLY_CONNECT_TIMEOUT_MS");
    expect(SOURCE).toContain("const FLY_CONNECT_TIMEOUT_MS = 75_000;");
    expect(SOURCE).toContain(
      'fetchWithTimeout(\n      "/api/kody/chat/terminal/resize"',
    );
    expect(SOURCE).toContain('"/api/kody/chat/terminal/input"');
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
    expect(SOURCE).toContain("waitMs: LOCAL_OUTPUT_WAIT_MS");
    expect(SOURCE).toContain("while (!cancelled)");
    expect(SOURCE).not.toContain("setInterval(() => void pollOutput(), 200)");
  });

  it("guards Fly socket writes so stale connect attempts cannot duplicate terminal output", () => {
    expect(SOURCE).toContain("flyConnectSeqRef");
    expect(SOURCE).toContain("flyConnectInFlightKeyRef");
    expect(SOURCE).toContain("isCurrentFlyConnect");
    expect(SOURCE).toContain("flySocketRef.current !== ws");
  });

  it("blocks Fly input until the remote shell is ready", () => {
    expect(SOURCE).toContain("type TerminalInputSignal");
    expect(SOURCE).toContain("Ready for input");
    expect(SOURCE).toContain("Input sent");
    expect(SOURCE).toContain("Waiting for terminal");
    expect(SOURCE).toContain("Input blocked");
    expect(SOURCE).toContain("onChromeStateChange");
    expect(SOURCE).toContain('flyConnectionStateRef.current === "connected"');
  });

  it("waits for bridge input acknowledgement before reporting input sent", () => {
    expect(SOURCE).toContain("nextFlyInputIdRef");
    expect(SOURCE).toContain("pendingFlyInputAckTimerRef");
    expect(SOURCE).toContain('type: "input"');
    expect(SOURCE).toContain("id: inputId");
    expect(SOURCE).toContain('message.type === "input-accepted"');
    expect(SOURCE).toContain('message.type === "input-rejected"');
    expect(SOURCE).toContain("Terminal input was not accepted");
  });

  it("reconnects the browser socket when Fly input acknowledgement stalls", () => {
    expect(SOURCE).toContain("reconnectFlyRef");
    expect(SOURCE).toContain("Terminal input stalled; reconnecting.");
    expect(SOURCE).toContain("terminal input acknowledgement timed out");
    expect(SOURCE).toContain(
      "reconnectFlyRef.current({ force: true, resetSession: false });",
    );
  });

  it("treats mobile browser socket loss as a reconnectable state", () => {
    expect(SOURCE).toContain("scheduleFlyReconnect");
    expect(SOURCE).toContain("Terminal connection interrupted; reconnecting.");
    expect(SOURCE).toContain('window.addEventListener("focus"');
    expect(SOURCE).toContain('window.addEventListener("online"');
    expect(SOURCE).toContain('"visibilitychange"');
    expect(SOURCE).toContain('document.visibilityState === "visible"');
    expect(SOURCE).toContain(
      "reconnectFlyRef.current({ force: true, resetSession: false });",
    );
    expect(SOURCE).not.toContain('setError("Terminal websocket error.")');
    expect(SOURCE).not.toContain(
      '"\\r\\n\\x1b[31mTerminal websocket error\\x1b[0m"',
    );
  });

  it("does not block remote input behind a restore-only browser state", () => {
    expect(SOURCE).not.toContain("flyRestorePending");
    expect(SOURCE).not.toContain('message.type === "restoring"');
    expect(SOURCE).not.toContain('message.type === "restore-failed"');
    expect(SOURCE).toContain('label: "Restoring terminal"');
    expect(SOURCE).not.toContain(
      "reconnectFlyRef.current({ force: true, resetSession: true });",
    );
  });

  it("does not reopen a remote terminal while the existing connection is restoring", () => {
    expect(SOURCE).toContain('existingState === "restoring"');
  });
});
