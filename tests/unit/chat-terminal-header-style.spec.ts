/**
 * @fileoverview Source-level guard for Kody-styled terminal chrome.
 * @testFramework vitest
 * @domain chat-terminal
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SURFACE_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/dashboard/lib/components/ChatTerminalSurface.tsx",
  ),
  "utf8",
);
const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/KodyChat.tsx"),
  "utf8",
);
const GLOBALS_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/globals.css"),
  "utf8",
);
const PACKAGE_SOURCE = readFileSync(
  resolve(__dirname, "../../package.json"),
  "utf8",
);

describe("terminal chrome style", () => {
  it("uses Kody app chrome instead of terminal chrome", () => {
    expect(SURFACE_SOURCE).toContain(
      "border-b border-border bg-background px-3 py-2",
    );
    expect(SURFACE_SOURCE).not.toContain(
      "border-b border-white/10 bg-black/30 px-2 py-1.5",
    );
  });

  it("keeps terminal history scrollable", () => {
    expect(SURFACE_SOURCE).toContain("scrollback: 10000");
    expect(SURFACE_SOURCE).toContain(
      "terminal-scroll-host h-full min-h-0 overflow-auto",
    );
    expect(SURFACE_SOURCE).toContain("wheelDeltaToTerminalLines");
    expect(SURFACE_SOURCE).toContain("terminal.attachCustomWheelEventHandler");
    expect(SURFACE_SOURCE).toContain("terminal.scrollLines");
    expect(SURFACE_SOURCE).toContain("event.preventDefault()");
    expect(SURFACE_SOURCE).not.toContain(
      'className="h-full min-h-0 overflow-hidden"',
    );
    expect(GLOBALS_SOURCE).toContain(".terminal-scroll-host .xterm-viewport");
    expect(GLOBALS_SOURCE).toContain("overflow-y: auto !important");
    expect(GLOBALS_SOURCE).toContain("scrollbar-width: thin");
  });

  it("uses shared Kody tokens for terminal toolbar controls", () => {
    expect(CHAT_SOURCE).toContain(
      "border border-border bg-background px-2 text-body-xs text-foreground",
    );
    expect(CHAT_SOURCE).toContain(
      "rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
    );
    expect(CHAT_SOURCE).not.toContain("border-[#27272a] bg-[#050608]");
    expect(CHAT_SOURCE).not.toContain("text-zinc-300");
    expect(CHAT_SOURCE).not.toContain("hover:bg-white/10 hover:text-white");
  });

  it("uses shared Kody tokens for terminal footer controls", () => {
    expect(CHAT_SOURCE).toContain('data-testid="chat-terminal-bottom-status"');
    expect(CHAT_SOURCE).not.toContain(
      'data-testid="chat-terminal-bottom-status"\n        className="flex min-w-0 shrink items-center gap-2 rounded-md border border-border bg-background px-2 py-1"',
    );
    expect(CHAT_SOURCE).not.toContain(
      'chatMode === "terminal" ? "bg-[#050608]"',
    );
    // The composer container / input-row / action-row chrome moved to
    // chat/surface/Composer in Step 3.4 — style pins are a Playwright
    // concern (phase-1 DOM decision), so those source assertions retired.
  });

  it("does not render redundant terminal footer status text", () => {
    expect(CHAT_SOURCE).not.toContain(
      '{activeTerminalChrome?.statusText ?? "terminal · closed"}',
    );
    expect(CHAT_SOURCE).not.toContain(
      '{activeTerminalChrome?.inputLabel ?? "No input"}',
    );
  });

  it("uses send button state and problem-only text for terminal input status", () => {
    expect(CHAT_SOURCE).toContain("terminalSendBusy");
    expect(CHAT_SOURCE).toContain("terminalSendDisabled");
    expect(CHAT_SOURCE).toContain("terminalProblemMessage");
    // The trailing send/stop button + problem line JSX moved to
    // chat/surface/Composer in Step 3.4 (the state computations above
    // stay host-side) — the rendered-markup pins are a Playwright
    // concern (phase-1 DOM decision), so those source assertions retired.
    expect(CHAT_SOURCE).not.toContain(
      'data-testid="chat-terminal-input-status-icon"',
    );
    expect(CHAT_SOURCE).not.toContain("terminalInputStatusClassName");
    expect(CHAT_SOURCE).not.toContain(
      "border-amber-500/70 focus:ring-amber-500/35",
    );
  });

  it("keeps terminal copy selection in the UI surface", () => {
    expect(SURFACE_SOURCE).toContain("terminal.onSelectionChange");
    expect(SURFACE_SOURCE).toContain("terminal.getSelection()");
    expect(SURFACE_SOURCE).toContain("copySelectedTerminalText");
    expect(SURFACE_SOURCE).toContain("navigator.clipboard.writeText");
    expect(SURFACE_SOURCE).toContain("Copy selection");
    expect(SURFACE_SOURCE).not.toContain("selectionCopy");
  });

  it("blocks remote input during terminal restore", () => {
    expect(SURFACE_SOURCE).toContain('| "restoring"');
    expect(SURFACE_SOURCE).toContain('state === "restoring"');
    expect(SURFACE_SOURCE).toContain(
      'flyConnectionStateRef.current === "connected"',
    );
    expect(SURFACE_SOURCE).not.toContain(
      'flySocketRef.current?.readyState === WebSocket.OPEN ||\n          flyConnectionStateRef.current === "connecting"',
    );
  });

  it("loads web links in the terminal UI surface", () => {
    expect(PACKAGE_SOURCE).toContain('"@xterm/addon-web-links"');
    expect(SURFACE_SOURCE).toContain('import("@xterm/addon-web-links")');
    expect(SURFACE_SOURCE).toContain("new WebLinksAddon");
    expect(SURFACE_SOURCE).toContain("terminal.loadAddon(webLinksAddon)");
  });
});
