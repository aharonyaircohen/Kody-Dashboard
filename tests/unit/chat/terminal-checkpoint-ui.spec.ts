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
    expect(CHAT_SOURCE).toContain("handleResetTerminalCheckpoint");
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

  it("uses the save icon for Brain image saves from the terminal toolbar", () => {
    expect(CHAT_SOURCE).toContain("Save Brain image");
    expect(CHAT_SOURCE).toContain("handleSaveBrainImage");
    expect(CHAT_SOURCE).toContain("/api/kody/brain/image");
    expect(CHAT_SOURCE).not.toContain("isActiveFlyBrainTerminal");
    expect(CHAT_SOURCE).not.toContain(
      "Select a Fly Brain terminal before saving its image",
    );
  });

  it("keeps the terminal target, actions, and mode toggle in stable footer columns", () => {
    expect(CHAT_SOURCE).toContain("const chatModeToggle =");
    expect(CHAT_SOURCE).toContain('data-testid="chat-terminal-toolbar"');
    expect(CHAT_SOURCE).toContain('data-testid="chat-terminal-target-row"');
    expect(CHAT_SOURCE).toContain('data-testid="chat-terminal-actions-row"');
    expect(CHAT_SOURCE).toContain(
      "grid-cols-[minmax(0,1fr)_auto] items-center",
    );
    expect(CHAT_SOURCE).toContain('className="col-span-full');
    expect(CHAT_SOURCE).toContain("{chatModeToggle}");
    expect(CHAT_SOURCE).toContain('{chatMode === "ai" && chatModeToggle}');
    expect(CHAT_SOURCE).toContain("bg-[#050608]");
    expect(CHAT_SOURCE).toContain("text-[#f4f4f5]");
  });

  it("restores Fly checkpoints without reconnecting automatically", () => {
    expect(CHAT_SOURCE).toContain("restoredSnapshotOnlyTerminalIds");
    expect(CHAT_SOURCE).toContain("readRestoredSnapshotOnlyTerminalIds");
    expect(CHAT_SOURCE).toContain("writeRestoredSnapshotOnlyTerminalIds");
    expect(CHAT_SOURCE).toContain("RESTORED_SNAPSHOT_ONLY_TERMINAL_IDS_KEY");
    expect(CHAT_SOURCE).toContain("suppressFlyAutoConnect");
    expect(SURFACE_SOURCE).toContain("suppressFlyAutoConnect");
    expect(SURFACE_SOURCE).toContain('updateFlyConnectionState("closed")');
  });

  it("does not loop forever when a Fly terminal connect fails", () => {
    expect(SURFACE_SOURCE).toContain("flyConnectFailureKeyRef");
    expect(SURFACE_SOURCE).toContain("handledFlyConnectNonceKeyRef");
    expect(SURFACE_SOURCE).toContain(
      "flyConnectFailureKeyRef.current === attemptKey",
    );
    expect(SURFACE_SOURCE).toContain(
      "handledFlyConnectNonceKeyRef.current === nonceKey",
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
    expect(SURFACE_SOURCE).toContain("sendExecutableInput");
    expect(SURFACE_SOURCE).toContain('replace(/\\n/g, "\\r")');
  });
});
