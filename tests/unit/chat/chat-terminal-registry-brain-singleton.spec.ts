/**
 * @fileoverview Unit coverage for the single Brain terminal registry rule.
 * @testFramework vitest
 * @domain terminal
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  canUseChatTerminalFlyMachine,
  findMountedBrainTerminal,
  isBrainTerminalTransport,
  normalizeMountedChatTerminals,
  normalizeTerminalTransport,
  upsertMountedChatTerminal,
  type MountedChatTerminal,
} from "@dashboard/lib/hooks/useChatTerminalRegistry";
import type { FlyMachineRow } from "@dashboard/lib/runners/fly-machine-model";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../../src/dashboard/lib/hooks/useChatTerminalRegistry.ts",
  ),
  "utf8",
);
const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/dashboard/lib/components/KodyChat.tsx"),
  "utf8",
);

function terminal(
  id: string,
  sessionId: string,
  feature?: "brain" | "runner",
): MountedChatTerminal {
  return {
    id,
    sessionId,
    transport: {
      type: "fly",
      app: feature === "brain" ? "brain-app" : "runner-app",
      machineId: id,
      feature,
    },
  };
}

describe("chat terminal registry Brain singleton", () => {
  it("filters Fly terminal choices to Brain machines only", () => {
    const baseMachine = {
      app: "kody-runner",
      machineId: "machine-1",
      state: "started",
      region: "fra",
      label: "machine",
      sizeLabel: "perf 1x · 2 GB",
    } satisfies Omit<FlyMachineRow, "feature">;

    expect(
      canUseChatTerminalFlyMachine({ ...baseMachine, feature: "brain" }),
    ).toBe(true);
    expect(
      canUseChatTerminalFlyMachine({ ...baseMachine, feature: "runner" }),
    ).toBe(false);
  });

  it("recognizes Brain as the singleton terminal transport", () => {
    expect(
      isBrainTerminalTransport({
        type: "fly",
        app: "brain",
        machineId: "m1",
        feature: "brain",
      }),
    ).toBe(true);
    expect(
      isBrainTerminalTransport({
        type: "fly",
        app: "runner",
        machineId: "m1",
        feature: "runner",
      }),
    ).toBe(false);
  });

  it("keeps only the newest mounted Brain terminal", () => {
    const firstBrain = terminal("brain-1", "chat-1", "brain");
    const runner = terminal("runner-1", "chat-2", "runner");
    const secondBrain = terminal("brain-2", "chat-3", "brain");

    expect(findMountedBrainTerminal([firstBrain, runner, secondBrain])).toBe(
      secondBrain,
    );
    expect(
      normalizeMountedChatTerminals([firstBrain, runner, secondBrain]),
    ).toEqual([secondBrain]);
  });

  it("updates the mounted Brain terminal when Brain is selected again", () => {
    const local = {
      id: "chat-1::local",
      sessionId: "chat-1",
      transport: { type: "local" },
    } satisfies MountedChatTerminal;
    const previousBrain = terminal("brain-old", "chat-1", "brain");
    const selectedBrain = {
      id: "chat-1::fly:brain-app:brain-new",
      sessionId: "chat-1",
      transport: {
        type: "fly",
        app: "brain-app",
        machineId: "brain-new",
        feature: "brain",
        label: "Brain",
      },
    } satisfies MountedChatTerminal;

    expect(
      upsertMountedChatTerminal([local, previousBrain], selectedBrain),
    ).toEqual([local, selectedBrain]);
  });

  it("maps stale Brain terminal selections to the current live Brain machine", () => {
    const staleTransport = {
      type: "fly",
      app: "brain-app",
      machineId: "old-machine",
      feature: "brain",
      label: "Brain server",
    } as const;
    const currentBrain = {
      app: "brain-app",
      machineId: "new-machine",
      state: "started",
      region: "fra",
      label: "Brain server",
      sizeLabel: "shared 2x · 4 GB",
      feature: "brain",
    } satisfies FlyMachineRow;

    expect(
      normalizeTerminalTransport(staleTransport, [currentBrain], {
        inventoryLoaded: true,
      }),
    ).toEqual({
      type: "fly",
      app: "brain-app",
      machineId: "new-machine",
      label: "Brain server",
      feature: "brain",
    });
  });

  it("preserves restored Brain selections until Fly inventory loads", () => {
    const staleTransport = {
      type: "fly",
      app: "brain-app",
      machineId: "old-machine",
      feature: "brain",
      label: "Brain server",
    } as const;

    expect(
      normalizeTerminalTransport(staleTransport, [], {
        inventoryLoaded: false,
      }),
    ).toBe(staleTransport);
    expect(
      normalizeTerminalTransport(staleTransport, [], {
        inventoryLoaded: true,
      }),
    ).toEqual({ type: "local" });
  });

  it("does not remount Brain when the selected target is unchanged", () => {
    const mounted = [
      {
        id: "chat-1::local",
        sessionId: "chat-1",
        transport: { type: "local" },
      },
      {
        id: "chat-1::fly:brain-app:brain-new",
        sessionId: "chat-1",
        transport: {
          type: "fly",
          app: "brain-app",
          machineId: "brain-new",
          feature: "brain",
          label: "Brain",
        },
      },
    ] satisfies MountedChatTerminal[];

    expect(
      upsertMountedChatTerminal(mounted, {
        id: "chat-1::fly:brain-app:brain-new",
        sessionId: "chat-1",
        transport: {
          type: "fly",
          app: "brain-app",
          machineId: "brain-new",
          feature: "brain",
          label: "Brain",
        },
      }),
    ).toBe(mounted);
  });

  it("focuses the existing Brain session instead of creating another one", () => {
    expect(REGISTRY_SOURCE).toContain("switchSession?:");
    expect(REGISTRY_SOURCE).toContain("focusMountedBrainTerminal");
    expect(REGISTRY_SOURCE).toContain(
      "switchSession?.(existingBrain.sessionId)",
    );
    expect(REGISTRY_SOURCE).toContain(
      "if (focusMountedBrainTerminal(nextTransport)) return;",
    );
    expect(CHAT_SOURCE).toContain("switchSession: sessionHook.switchSession");
  });

  it("saves Brain images through the Brain service, not stale terminal ids", () => {
    expect(CHAT_SOURCE).toContain("body: JSON.stringify({})");
    expect(CHAT_SOURCE).not.toContain("body: JSON.stringify(requestBody)");
  });
});
