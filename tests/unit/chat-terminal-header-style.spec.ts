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

describe("terminal chrome style", () => {
  it("uses Kody app chrome instead of terminal chrome", () => {
    expect(SURFACE_SOURCE).toContain(
      "border-b border-border bg-background px-3 py-2",
    );
    expect(SURFACE_SOURCE).not.toContain(
      "border-b border-white/10 bg-black/30 px-2 py-1.5",
    );
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
    expect(CHAT_SOURCE).toContain(
      "relative z-10 shrink-0 border-t bg-background px-2.5 py-3 sm:p-4",
    );
    expect(CHAT_SOURCE).not.toContain(
      'data-testid="chat-terminal-bottom-status"\n        className="flex min-w-0 shrink items-center gap-2 rounded-md border border-border bg-background px-2 py-1"',
    );
    expect(CHAT_SOURCE).not.toContain('chatMode === "terminal" ? "bg-[#050608]"');
    expect(CHAT_SOURCE).toContain('"border-b border-border/40 pb-2"');
    expect(CHAT_SOURCE).toContain('"pt-2"');
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
    expect(CHAT_SOURCE).toContain("disabled={terminalSendDisabled}");
    expect(CHAT_SOURCE).toContain("Sending command");
    expect(CHAT_SOURCE).toContain("{terminalProblemMessage}");
    expect(CHAT_SOURCE).not.toContain(
      'data-testid="chat-terminal-input-status-icon"',
    );
    expect(CHAT_SOURCE).not.toContain("terminalInputStatusClassName");
    expect(CHAT_SOURCE).not.toContain("border-amber-500/70 focus:ring-amber-500/35");
  });
});
