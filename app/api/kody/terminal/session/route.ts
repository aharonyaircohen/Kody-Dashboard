/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern terminal-session-start
 *
 * POST /api/kody/terminal/session
 *
 * Starts a browser terminal session by ensuring the Fly terminal bridge exists
 * and minting a short-lived encrypted token for it. The Fly token stays
 * encrypted inside that token; the dashboard never returns it as plain JSON.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { readBrainRuntimeView } from "@dashboard/lib/brain/runtime-manager";
import { resolveBrainTerminalConnect } from "@dashboard/lib/brain/terminal-connect";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { startMachine } from "@dashboard/lib/previews/fly-previews";
import {
  flyConfigFromContext,
  resolveFlyContext,
} from "@dashboard/lib/runners/fly-context";
import {
  ensureTerminalBridge,
  type TerminalBridgeInfo,
} from "@dashboard/lib/terminal/bridge-fly";
import {
  loadTerminalInventoryAuthority,
  terminalBridgeConfigCandidates,
  terminalFlyConfigForMachine,
} from "@dashboard/lib/terminal/server-inventory";
import {
  buildTerminalWebSocketUrl,
  isTerminalFeatureAllowed,
  isTerminalMachineLive,
  isTerminalMachineStartable,
  resolveTerminalTargetMachine,
  selectTerminalTarget,
  terminalActivityLimitForTarget,
  type TerminalTargetInput,
} from "@dashboard/lib/terminal/session";
import { mintTerminalBridgeToken } from "@dashboard/lib/terminal/terminal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Body = z.object({
  target: z.literal("brain").optional(),
  app: z.string().min(1).max(120).optional(),
  machineId: z.string().min(1).max(120).optional(),
  feature: z.enum(["runner", "brain"]).optional(),
  chatSessionId: z.string().min(1).max(160).optional(),
  resetSession: z.boolean().optional(),
  activityLimitMs: z
    .union([
      z
        .number()
        .int()
        .min(60_000)
        .max(24 * 60 * 60_000),
      z.null(),
    ])
    .optional(),
  cols: z.number().int().min(20).max(300).optional(),
  rows: z.number().int().min(8).max(120).optional(),
}).superRefine((value, ctx) => {
  if (value.target === "brain") return;
  if (!value.app) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["app"],
      message: "app is required",
    });
  }
  if (!value.machineId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["machineId"],
      message: "machineId is required",
    });
  }
});

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
    /startMachine failed: (401|403)/.test(text) ||
    /fetch failed|Connect Timeout|ETIMEDOUT|ECONNRESET/i.test(text)
  );
}

async function ensureTerminalBridgeForTarget(
  cfg: ReturnType<typeof terminalFlyConfigForMachine>,
): Promise<{ bridge: TerminalBridgeInfo; terminalCfg: typeof cfg }> {
  let lastErr: unknown;
  const candidates = terminalBridgeConfigCandidates(cfg);
  for (const candidate of candidates) {
    try {
      return {
        bridge: await ensureTerminalBridge(candidate),
        terminalCfg: candidate,
      };
    } catch (err) {
      lastErr = err;
      if (!isFlyBridgeAuthError(err)) throw err;
    }
  }
  throw lastErr;
}

async function startMachineForTarget(
  app: string,
  machineId: string,
  cfg: ReturnType<typeof terminalFlyConfigForMachine>,
): Promise<void> {
  let lastErr: unknown;
  for (const candidate of terminalBridgeConfigCandidates(cfg)) {
    try {
      await startMachine(app, machineId, candidate);
      return;
    } catch (err) {
      lastErr = err;
      if (!isFlyBridgeAuthError(err)) throw err;
    }
  }
  throw lastErr;
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const ctx = await resolveFlyContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const cfg = flyConfigFromContext(ctx.context);
  if (!cfg) {
    return NextResponse.json({ error: "fly_token_missing" }, { status: 503 });
  }

  try {
    const brainRequested =
      parsed.data.target === "brain" || parsed.data.feature === "brain";
    let { inventory, savedBrain } = await loadTerminalInventoryAuthority(
      req,
      cfg,
      {
        brainRequested,
        app: parsed.data.app,
        machineId: parsed.data.machineId,
      },
    );
    if (brainRequested && savedBrain?.brain.reason === "fly_access_denied") {
      return NextResponse.json(
        {
          error: "fly_access_denied",
          message: TARGET_MESSAGE.fly_access_denied,
          app: savedBrain.brain.app,
          org: savedBrain.brain.orgSlug,
        },
        { status: TARGET_STATUS.fly_access_denied },
      );
    }
    let brainWarnings: ReturnType<
      typeof resolveBrainTerminalConnect
    >["warnings"] = [];
    let targetInput: TerminalTargetInput | null =
      parsed.data.app && parsed.data.machineId
        ? {
            app: parsed.data.app,
            machineId: parsed.data.machineId,
            feature: parsed.data.feature,
          }
        : null;
    if (brainRequested) {
      setGitHubContext(
        ctx.context.owner,
        ctx.context.repo,
        ctx.context.githubToken,
        ctx.context.storeRepoUrl,
        ctx.context.storeRef,
      );
      try {
        const runtime = await readBrainRuntimeView(
          ctx.context.account,
          ctx.context.githubToken,
        );
        const decision = resolveBrainTerminalConnect({
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
      return NextResponse.json(
        {
          error: "machine_not_found",
          message: TARGET_MESSAGE.machine_not_found,
        },
        { status: TARGET_STATUS.machine_not_found },
      );
    }
    const requested = resolveTerminalTargetMachine(inventory, targetInput);
    if (!requested) {
      return NextResponse.json(
        {
          error: "machine_not_found",
          message: TARGET_MESSAGE.machine_not_found,
        },
        { status: TARGET_STATUS.machine_not_found },
      );
    }
    if (!isTerminalFeatureAllowed(requested.feature)) {
      return NextResponse.json(
        {
          error: "machine_not_terminal_capable",
          message: TARGET_MESSAGE.machine_not_terminal_capable,
        },
        { status: TARGET_STATUS.machine_not_terminal_capable },
      );
    }
    if (!isTerminalMachineLive(requested.state)) {
      if (!isTerminalMachineStartable(requested.state)) {
        return NextResponse.json(
          {
            error: "machine_not_running",
            message: TARGET_MESSAGE.machine_not_running,
          },
          { status: TARGET_STATUS.machine_not_running },
        );
      } else {
        logger.info(
          { app: requested.app, machineId: requested.machineId },
          "terminal: waking machine",
        );
        const requestedCfg = terminalFlyConfigForMachine(
          cfg,
          requested,
          savedBrain,
        );
        await startMachineForTarget(
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
          const refreshed = await loadTerminalInventoryAuthority(req, cfg, {
            brainRequested: requested.feature === "brain",
            app: requested.app,
            machineId: requested.machineId,
          });
          inventory = refreshed.inventory;
          savedBrain = refreshed.savedBrain ?? savedBrain;
          const next = resolveTerminalTargetMachine(inventory, selectedInput);
          if (next && isTerminalMachineLive(next.state)) break;
        }
      }
    }

    const selected = selectTerminalTarget(inventory, {
      app: requested.app,
      machineId: requested.machineId,
    });
    if (!selected.ok) {
      return NextResponse.json(
        { error: selected.error, message: TARGET_MESSAGE[selected.error] },
        { status: TARGET_STATUS[selected.error] ?? 400 },
      );
    }
    const selectedCfg = terminalFlyConfigForMachine(
      cfg,
      selected.machine,
      savedBrain,
    );
    const { bridge, terminalCfg } =
      await ensureTerminalBridgeForTarget(selectedCfg);
    const activityLimitMs = terminalActivityLimitForTarget(
      selected.machine.feature,
      parsed.data.activityLimitMs,
    );
    const now = Math.floor(Date.now() / 1000);
    const token = mintTerminalBridgeToken({
      owner: ctx.context.owner,
      repo: ctx.context.repo,
      app: selected.machine.app,
      orgSlug: terminalCfg.orgSlug,
      machineId: selected.machine.machineId,
      chatSessionId: parsed.data.chatSessionId,
      resetSession: parsed.data.resetSession,
      ...(activityLimitMs !== undefined ? { activityLimitMs } : {}),
      flyToken: terminalCfg.token,
      cols: parsed.data.cols,
      rows: parsed.data.rows,
      now,
      secret: bridge.secret,
    });
    const webSocketUrl = buildTerminalWebSocketUrl(bridge.url, token);

    return NextResponse.json({
      ok: true,
      app: selected.machine.app,
      machineId: selected.machine.machineId,
      label: selected.machine.label,
      bridgeApp: bridge.app,
      expiresAt: new Date((now + 120) * 1000).toISOString(),
      webSocketUrl,
      ...(brainWarnings.length ? { warnings: brainWarnings } : {}),
    });
  } catch (err) {
    logger.error(
      { err, owner: ctx.context.owner, repo: ctx.context.repo },
      "terminal: session start failed",
    );
    return NextResponse.json(
      { error: "terminal_session_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
