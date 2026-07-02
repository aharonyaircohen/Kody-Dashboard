/**
 * @fileoverview Regression guard for terminal registry restore on page refresh.
 * @testFramework vitest
 * @domain terminal
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../../src/dashboard/lib/hooks/useChatTerminalRegistry.ts",
  ),
  "utf8",
);
const SESSIONS_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/dashboard/lib/hooks/useChatSessions.ts"),
  "utf8",
);
const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/dashboard/lib/components/KodyChat.tsx"),
  "utf8",
);

describe("chat terminal registry refresh persistence", () => {
  it("does not prune restored Fly terminals before chat sessions hydrate", () => {
    expect(SESSIONS_SOURCE).toContain("hydrated: boolean");
    expect(SESSIONS_SOURCE).toContain("hydrated: store !== null");
    expect(REGISTRY_SOURCE).toContain("sessionsHydrated?: boolean");
    expect(REGISTRY_SOURCE).toContain("sessionsHydrated = true");
    expect(REGISTRY_SOURCE).toContain("if (!sessionsHydrated) return;");
    expect(CHAT_SOURCE).toContain("sessionsHydrated: sessionHook.hydrated");
  });

  it("refreshes status for local terminals by chat session only", () => {
    expect(REGISTRY_SOURCE).toContain('terminal.transport.type === "local"');
    expect(REGISTRY_SOURCE).not.toContain('params.set("sandboxId"');
    expect(REGISTRY_SOURCE).toContain("/api/kody/chat/terminal/status?");
    expect(REGISTRY_SOURCE).toContain("${params}");
  });

  it("refreshes and reconciles Brain terminal targets after image apply", () => {
    expect(REGISTRY_SOURCE).toContain('"kody:fly-machines-refresh"');
    expect(REGISTRY_SOURCE).toContain(
      "reconcileMountedChatTerminalsWithInventory",
    );
    expect(REGISTRY_SOURCE).toContain("normalizeTerminalTransport(");
    expect(REGISTRY_SOURCE).toContain("setMountedTerminals((prev)");
  });
});
