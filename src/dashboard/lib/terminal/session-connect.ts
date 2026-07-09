/**
 * @fileType use-case
 * @domain terminal
 * @pattern terminal-session-connect
 *
 * Command boundary for opening a Fly terminal session. API routes validate HTTP
 * input; this layer decides target, wake behavior, bridge authority, and token.
 */
import "server-only";

import type { NextRequest } from "next/server";

import { readBrainRuntimeView } from "@dashboard/lib/brain/runtime-manager";
import { connectBrainTerminal } from "@dashboard/lib/brain/terminal-connect";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { startServerProviderMachine } from "@dashboard/lib/infrastructure/server-machines";
import {
  serverProviderConfigFromContext,
  type ServerProviderContext,
} from "@dashboard/lib/infrastructure/server-context";

import {
  ensureServerProviderTerminalBridge,
  type ServerProviderTerminalBridgeInfo,
} from "@dashboard/lib/infrastructure/server-terminal";
import {
  loadTerminalInventoryAuthority,
  terminalBridgeConfigCandidates,
  terminalFlyConfigForMachine,
} from "./server-inventory";
import {
  buildTerminalWebSocketUrl,
  isTerminalFeatureAllowed,
  isTerminalMachineLive,
  isTerminalMachineStartable,
  resolveTerminalTargetMachine,
  selectTerminalTarget,
  terminalBridgeSessionIdForTarget,
  terminalActivityLimitForTarget,
  type TerminalTargetInput,
} from "./session";
import { mintTerminalBridgeToken } from "./terminal-token";

export interface StartTerminalSessionData {
  target?: "brain";
  app?: string;
  machineId?: string;
  feature?: "runner" | "brain";
  chatSessionId?: string;
  resetSession?: boolean;
  activityLimitMs?: number | null;
  cols?: number;
  rows?: number;
}

export class TerminalSessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const TARGET_STATUS: Record<string, number> = {
  machine_not_found: 404,
  machine_not_terminal_capable: 403,
  machine_not_running: 409,
  fly_access_denied: 403,
};

const TARGET_MESSAGE: Record<string, string> = {
  machine_not_found: "Machine not found.",
  machine_not_terminal_capable: "Only Brain machines can open a Fly terminal.",
  machine_not_running:
    "Brain machine did not become ready in time. Try Connect again.",
  fly_access_denied: "Fly token cannot access this Brain app.",
};

const WAKE_POLL_ATTEMPTS = 60;
const WAKE_POLL_INTERVAL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFlyBridgeAuthError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return (
    /Fly Machines API (401|403) on \/(apps|apps\/)/.test(text) ||
    /(startServerProviderMachine|startMachine) failed: (401|403)/.test(text) ||
    /fetch failed|Connect Timeout|ETIMEDOUT|ECONNRESET/i.test(text)
  );
}

function isFlyMachineAlreadyStartingError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return (
    /(startServerProviderMachine|startMachine) failed: 409/.test(text) &&
    /machine still attempting to start/i.test(text)
  );
}

async function ensureServerProviderTerminalBridgeForTarget(
  cfg: ReturnType<typeof terminalFlyConfigForMachine>,
): Promise<{
  bridge: ServerProviderTerminalBridgeInfo;
  terminalCfg: typeof cfg;
}> {
  let lastErr: unknown;
  const candidates = terminalBridgeConfigCandidates(cfg);
  for (const candidate of candidates) {
    try {
      return {
        bridge: await ensureServerProviderTerminalBridge(candidate),
        terminalCfg: candidate,
      };
    } catch (err) {
      lastErr = err;
      if (!isFlyBridgeAuthError(err)) throw err;
    }
  }
  throw lastErr;
}

async function startServerProviderMachineForTarget(
  app: string,
  machineId: string,
  cfg: ReturnType<typeof terminalFlyConfigForMachine>,
): Promise<void> {
  let lastErr: unknown;
  for (const candidate of terminalBridgeConfigCandidates(cfg)) {
    try {
      await startServerProviderMachine(app, machineId, candidate);
      return;
    } catch (err) {
      lastErr = err;
      if (isFlyMachineAlreadyStartingError(err)) return;
      if (!isFlyBridgeAuthError(err)) throw err;
    }
  }
  throw lastErr;
}

function targetError(code: string, details: Record<string, unknown> = {}) {
  return new TerminalSessionError(
    code,
    TARGET_MESSAGE[code] ?? code,
    TARGET_STATUS[code] ?? 400,
    details,
  );
}

export async function startTerminalSession(input: {
  req: NextRequest;
  context: ServerProviderContext;
  data: StartTerminalSessionData;
}) {
  const { req, context, data } = input;
  const cfg = serverProviderConfigFromContext(context);
  if (!cfg) {
    throw new TerminalSessionError(
      "fly_token_missing",
      "fly_token_missing",
      503,
    );
  }

  const brainRequested = data.target === "brain" || data.feature === "brain";
  let { inventory, savedBrain } = await loadTerminalInventoryAuthority(
    req,
    cfg,
    {
      brainRequested,
      app: data.app,
      machineId: data.machineId,
    },
    context,
  );
  if (brainRequested && savedBrain?.brain.reason === "fly_access_denied") {
    throw targetError("fly_access_denied", {
      app: savedBrain.brain.app,
      org: savedBrain.brain.orgSlug,
    });
  }

  let brainWarnings: ReturnType<typeof connectBrainTerminal>["warnings"] = [];
  let targetInput: TerminalTargetInput | null =
    data.app && data.machineId
      ? {
          app: data.app,
          machineId: data.machineId,
          feature: data.feature,
        }
      : null;
  if (brainRequested) {
    setGitHubContext(
      context.owner,
      context.repo,
      context.githubToken,
      context.storeRepoUrl,
      context.storeRef,
    );
    try {
      const runtime = await readBrainRuntimeView(
        context.account,
        context.githubToken,
      );
      const decision = connectBrainTerminal({
        runtime,
        inventory,
        requestedTarget: targetInput,
      });
      targetInput = decision.targetInput;
      brainWarnings = decision.warnings;
    } finally {
      clearGitHubContext();
    }
  }

  if (!targetInput) {
    throw targetError("machine_not_found");
  }
  const requested = resolveTerminalTargetMachine(inventory, targetInput);
  if (!requested) {
    throw targetError("machine_not_found");
  }
  if (!isTerminalFeatureAllowed(requested.feature)) {
    throw targetError("machine_not_terminal_capable");
  }
  if (!isTerminalMachineLive(requested.state)) {
    if (!isTerminalMachineStartable(requested.state)) {
      throw targetError("machine_not_running");
    }
    logger.info(
      { app: requested.app, machineId: requested.machineId },
      "terminal: waking machine",
    );
    const requestedCfg = terminalFlyConfigForMachine(
      cfg,
      requested,
      savedBrain,
    );
    await startServerProviderMachineForTarget(
      requested.app,
      requested.machineId,
      requestedCfg,
    );
    const selectedInput = {
      app: requested.app,
      machineId: requested.machineId,
    };
    for (let attempt = 0; attempt < WAKE_POLL_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(WAKE_POLL_INTERVAL_MS);
      const refreshed = await loadTerminalInventoryAuthority(
        req,
        cfg,
        {
          brainRequested: requested.feature === "brain",
          app: requested.app,
          machineId: requested.machineId,
        },
        context,
      );
      inventory = refreshed.inventory;
      savedBrain = refreshed.savedBrain ?? savedBrain;
      const next = resolveTerminalTargetMachine(inventory, selectedInput);
      if (next && isTerminalMachineLive(next.state)) break;
    }
  }

  const selected = selectTerminalTarget(inventory, {
    app: requested.app,
    machineId: requested.machineId,
  });
  if (!selected.ok) {
    throw targetError(selected.error);
  }
  const selectedCfg = terminalFlyConfigForMachine(
    cfg,
    selected.machine,
    savedBrain,
  );
  const { bridge, terminalCfg } =
    await ensureServerProviderTerminalBridgeForTarget(selectedCfg);
  const activityLimitMs = terminalActivityLimitForTarget(
    selected.machine.feature,
    data.activityLimitMs,
  );
  const now = Math.floor(Date.now() / 1000);
  const bridgeSessionId = terminalBridgeSessionIdForTarget({
    owner: context.owner,
    repo: context.repo,
    app: selected.machine.app,
    machineId: selected.machine.machineId,
    feature: selected.machine.feature,
    requestedChatSessionId: data.chatSessionId,
  });
  const token = mintTerminalBridgeToken({
    owner: context.owner,
    repo: context.repo,
    app: selected.machine.app,
    orgSlug: terminalCfg.orgSlug,
    machineId: selected.machine.machineId,
    chatSessionId: bridgeSessionId,
    resetSession: data.resetSession,
    ...(activityLimitMs !== undefined ? { activityLimitMs } : {}),
    flyToken: terminalCfg.token,
    cols: data.cols,
    rows: data.rows,
    now,
    secret: bridge.secret,
  });
  const webSocketUrl = buildTerminalWebSocketUrl(bridge.url, token);

  return {
    ok: true,
    app: selected.machine.app,
    machineId: selected.machine.machineId,
    label: selected.machine.label,
    bridgeApp: bridge.app,
    expiresAt: new Date((now + 120) * 1000).toISOString(),
    webSocketUrl,
    ...(brainWarnings.length ? { warnings: brainWarnings } : {}),
  };
}
