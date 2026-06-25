/**
 * @fileoverview Source-level guard for saved terminal snapshot UI wiring.
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

describe("saved terminal snapshot UI", () => {
  it("exposes save, list, delete, and restore controls in terminal mode", () => {
    expect(CHAT_SOURCE).toContain("Save terminal snapshot");
    expect(CHAT_SOURCE).toContain("Saved terminal snapshots");
    expect(CHAT_SOURCE).toContain("handleSaveTerminalSnapshot");
    expect(CHAT_SOURCE).toContain("handleRestoreTerminalSnapshot");
    expect(CHAT_SOURCE).toContain("handleDeleteTerminalSnapshot");
    expect(CHAT_SOURCE).toContain("/api/kody/chat/terminal/saved");
  });

  it("can capture and replay a terminal snapshot from the terminal surface", () => {
    expect(SURFACE_SOURCE).toContain("getSnapshot");
    expect(SURFACE_SOURCE).toContain("restoreSnapshot");
    expect(SURFACE_SOURCE).toContain("## Restored terminal snapshot");
  });

  it("supports opt-in auto-save when a terminal session ends", () => {
    expect(CHAT_SOURCE).toContain("Auto-save on stop");
    expect(CHAT_SOURCE).toContain("autoSaveTerminalOnEnd");
    expect(CHAT_SOURCE).toContain("savedTerminalAutoSaveId");
    expect(CHAT_SOURCE).toContain("handleAutoSaveTerminalSnapshot");
    expect(CHAT_SOURCE).toContain("onSessionEnded");
    expect(CHAT_SOURCE).not.toContain('successMessage: "Terminal auto-saved"');
    expect(SURFACE_SOURCE).toContain("onSessionEnded");
    expect(SURFACE_SOURCE).toContain("notifyTerminalSessionEnded");
  });

  it("restores Fly snapshots without reconnecting automatically", () => {
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
});
