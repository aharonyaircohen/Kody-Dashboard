/**
 * @fileoverview Source-level guard for terminal checkpoint UI wiring.
 * @testFramework vitest
 * @domain terminal
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/dashboard/lib/components/KodyChat.tsx"),
  "utf8",
);
const SURFACE_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../../src/dashboard/lib/components/ChatTerminalSurface.tsx",
  ),
  "utf8",
);

describe("terminal checkpoint UI", () => {
  it("hides snapshot selection and manual terminal snapshot saves", () => {
    expect(CHAT_SOURCE).not.toContain("Save terminal snapshot");
    expect(CHAT_SOURCE).not.toContain("Saved terminal snapshots");
    expect(CHAT_SOURCE).not.toContain("handleSaveTerminalSnapshot");
    expect(CHAT_SOURCE).not.toContain("handleRestoreTerminalSnapshot");
    expect(CHAT_SOURCE).not.toContain("handleDeleteTerminalSnapshot");
    expect(CHAT_SOURCE).not.toContain("/api/kody/chat/terminal/saved");
    expect(CHAT_SOURCE).toContain("/api/kody/chat/terminal/checkpoint");
    expect(CHAT_SOURCE).not.toContain("handleResetTerminalCheckpoint");
    expect(CHAT_SOURCE).not.toContain("Reset terminal checkpoint");
  });

  it("can capture and replay a terminal checkpoint from the terminal surface", () => {
    expect(SURFACE_SOURCE).toContain("getSnapshot");
    expect(SURFACE_SOURCE).toContain("restoreSnapshot");
    expect(SURFACE_SOURCE).toContain("## Restored terminal snapshot");
  });

  it("auto-saves checkpoints when a terminal session ends", () => {
    expect(CHAT_SOURCE).not.toContain("Auto-save on stop");
    expect(CHAT_SOURCE).not.toContain("autoSaveTerminalOnEnd");
    expect(CHAT_SOURCE).not.toContain("savedTerminalAutoSaveId");
    expect(CHAT_SOURCE).toContain("saveTerminalCheckpoint");
    expect(CHAT_SOURCE).toContain("onSessionEnded");
    expect(CHAT_SOURCE).not.toContain(
      'if (terminal.transport.type === "fly") return',
    );
    expect(SURFACE_SOURCE).toContain("onSessionEnded");
    expect(SURFACE_SOURCE).toContain("notifyTerminalSessionEnded");
  });

  it("does not replay a checkpoint over a live terminal session", () => {
    expect(CHAT_SOURCE).toContain("activeSessionHasLiveTerminal");
    expect(CHAT_SOURCE).toContain("if (activeSessionHasLiveTerminal) return;");
  });

  it("uses the save icon for Brain image saves from the terminal toolbar", () => {
    expect(CHAT_SOURCE).toContain("Save Brain image");
    expect(CHAT_SOURCE).toContain("handleSaveBrainImage");
    expect(CHAT_SOURCE).toContain("/api/kody/brain/image");
    expect(CHAT_SOURCE).not.toContain("isActiveFlyBrainTerminal");
    expect(CHAT_SOURCE).not.toContain(
      "Select a Fly Brain terminal before saving its image",
    );
  });

  it("keeps terminal target and save/refresh actions in the terminal top bar", () => {
    expect(CHAT_SOURCE).toContain("const chatModeToggle =");
    expect(CHAT_SOURCE).toContain("const terminalTopControls =");
    expect(CHAT_SOURCE).toContain("const terminalBottomControls =");
    expect(CHAT_SOURCE).toContain('data-testid="chat-terminal-toolbar"');
    expect(CHAT_SOURCE).toContain('data-testid="chat-terminal-target-row"');
    expect(CHAT_SOURCE).toContain('data-testid="chat-terminal-actions-row"');
    expect(CHAT_SOURCE).toContain('data-testid="chat-terminal-bottom-status"');
    expect(CHAT_SOURCE).toContain('href="/fly/brain-images"');
    expect(CHAT_SOURCE).toContain("Manage Brain images");
    expect(CHAT_SOURCE).toContain("topToolbar={terminalTopControls}");
    expect(CHAT_SOURCE).toContain("onChromeStateChange");
    expect(CHAT_SOURCE).toContain("activeTerminalSurface?.restart()");
    expect(CHAT_SOURCE).toContain("activeTerminalSurface?.addToChat()");
    expect(CHAT_SOURCE).toContain("activeTerminalSurface?.clear()");
    // The action-row placement of chatModeToggle / terminalBottomControls
    // moved to chat/surface/Composer in Step 3.4 — placement pins are a
    // Playwright concern (phase-1 DOM decision), so those source
    // assertions retired. The elements themselves stay host-built until
    // Step 5a moves them into plugins/terminal (pinned above).
    expect(CHAT_SOURCE).toContain(
      "relative inline-flex h-8 w-8 items-center justify-center rounded",
    );
    expect(CHAT_SOURCE).toContain("title={`Terminal ${terminalStatusLabel}`}");
    expect(CHAT_SOURCE).not.toContain("{terminalStatusLabel}</span>");
    // The terminal-mode container chrome (`bg-[#050608]`) moved to
    // chat/surface/MessageList in Step 3.3 — style pins are a Playwright
    // concern (phase-1 DOM decision), so the source assertion retired.
    expect(CHAT_SOURCE).toContain("text-foreground");
    expect(SURFACE_SOURCE).toContain("topToolbar?: ReactNode");
    expect(SURFACE_SOURCE).toContain("onChromeStateChange");
    expect(SURFACE_SOURCE).toContain("{topToolbar &&");
    expect(SURFACE_SOURCE).not.toContain("border-t border-white/10");
  });

  it("lets Fly target selection own terminal connection", () => {
    expect(CHAT_SOURCE).not.toContain("Connect Fly terminal");
    expect(CHAT_SOURCE).not.toContain("Disconnect Fly terminal");
    expect(CHAT_SOURCE).not.toContain("handleTerminalFlyConnectToggle");
    expect(CHAT_SOURCE).not.toContain("restoredSnapshotOnlyTerminalIds");
    expect(CHAT_SOURCE).not.toContain(
      "RESTORED_SNAPSHOT_ONLY_TERMINAL_IDS_KEY",
    );
    expect(CHAT_SOURCE).not.toContain("suppressFlyAutoConnect");
    expect(SURFACE_SOURCE).not.toContain("suppressFlyAutoConnect");
    expect(SURFACE_SOURCE).toContain("void connectFly();");
  });

  it("does not loop forever when a Fly terminal connect fails", () => {
    expect(SURFACE_SOURCE).toContain("flyConnectFailureKeyRef");
    expect(SURFACE_SOURCE).toContain(
      "flyConnectFailureKeyRef.current === attemptKey",
    );
  });

  it("routes /terminal chat commands through Kody before terminal input", () => {
    expect(CHAT_SOURCE).toContain("parseKodyTerminalIntent");
    expect(CHAT_SOURCE).toContain("buildKodyTerminalPrompt");
    expect(CHAT_SOURCE).toContain("extractKodyTerminalPayload");
    expect(CHAT_SOURCE).toContain("sendKodyTerminalPayloadToTerminal");
    expect(CHAT_SOURCE).toContain("LOCAL_TERMINAL_TRANSPORT");
    expect(CHAT_SOURCE).toContain(
      "terminalRegistry.openTerminalMode(LOCAL_TERMINAL_TRANSPORT)",
    );
    expect(CHAT_SOURCE).toContain("forceAgentId?: AgentId");
    expect(CHAT_SOURCE).toContain('forceAgentId: "kody"');
    expect(
      CHAT_SOURCE.indexOf("parseKodyTerminalIntent(rawInput)"),
    ).toBeLessThan(
      CHAT_SOURCE.indexOf("expandSlashCommand(rawInput, slashCommands)"),
    );
  });

  it("can execute multiline Kody output in the terminal surface", () => {
    expect(SURFACE_SOURCE).toContain("executeText: (text: string) => boolean");
    expect(CHAT_SOURCE).toContain("terminal?.executeText");
    expect(SURFACE_SOURCE).toContain("sendImplementationInput");
    expect(SURFACE_SOURCE).toContain('replace(/\\n/g, "\\r")');
  });
});
