/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern fly-terminal-status
 *
 * POST /api/kody/terminal/status
 *
 * Checks whether a chat-backed Fly terminal session is still alive.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireKodyAuth } from "@dashboard/lib/auth";
import {
  flyConfigFromContext,
  resolveFlyContext,
} from "@dashboard/lib/runners/fly-context";
import {
  applySavedBrainMachineToInventory,
  resolveSavedBrainServiceForRequest,
  type SavedBrainServiceForRequest,
} from "@dashboard/lib/runners/fly-inventory-server";
import {
  listFlyInventory,
  type FlyInventory,
  type FlyMachineRow,
} from "@dashboard/lib/runners/fly-inventory";
import type { FlyPreviewConfig } from "@dashboard/lib/previews/fly-previews";
import { findTerminalBridge } from "@dashboard/lib/terminal/bridge-fly";
import {
  resolveBrainTerminalTargetInput,
  resolveTerminalTargetMachine,
} from "@dashboard/lib/terminal/session";
import { mintTerminalBridgeToken } from "@dashboard/lib/terminal/terminal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  target: z.literal("brain").optional(),
  app: z.string().min(1).max(120).optional(),
  machineId: z.string().min(1).max(120).optional(),
  feature: z.enum(["runner", "brain"]).optional(),
  chatSessionId: z.string().min(1).max(160),
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

function terminalTargetFlyConfig(
  cfg: FlyPreviewConfig,
  orgSlug: string | undefined,
): FlyPreviewConfig {
  return orgSlug && orgSlug !== cfg.orgSlug ? { ...cfg, orgSlug } : cfg;
}

function terminalFlyConfigForMachine(
  cfg: FlyPreviewConfig,
  machine: FlyMachineRow,
  savedBrain: SavedBrainServiceForRequest | null,
): FlyPreviewConfig {
  const savedBrainMachine = savedBrain?.brain.machine;
  const usesSavedBrainToken =
    machine.feature === "brain" &&
    savedBrain &&
    savedBrainMachine?.app === machine.app &&
    savedBrainMachine.machineId === machine.machineId;
  const baseCfg = usesSavedBrainToken
    ? { ...cfg, token: savedBrain.flyToken }
    : cfg;
  return terminalTargetFlyConfig(baseCfg, machine.orgSlug);
}

async function appendSavedBrainForTerminal(
  req: NextRequest,
  inventory: FlyInventory,
): Promise<SavedBrainServiceForRequest | null> {
  const savedBrain = await resolveSavedBrainServiceForRequest(req);
  if (savedBrain) {
    applySavedBrainMachineToInventory(inventory, savedBrain.brain);
  }
  return savedBrain;
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
    return NextResponse.json({ ok: true, alive: false });
  }
  const cfg = flyConfigFromContext(ctx.context);
  if (!cfg) {
    return NextResponse.json({ ok: true, alive: false });
  }

  let targetCfg = cfg;
  let targetApp = parsed.data.app ?? "";
  let targetMachineId = parsed.data.machineId ?? "";
  const brainRequested =
    parsed.data.target === "brain" || parsed.data.feature === "brain";
  try {
    const inventory = await listFlyInventory(cfg);
    const savedBrain = await appendSavedBrainForTerminal(req, inventory);
    let targetInput:
      | { app: string; machineId: string; feature?: "runner" | "brain" }
      | null =
      parsed.data.app && parsed.data.machineId
        ? {
            app: parsed.data.app,
            machineId: parsed.data.machineId,
            feature: parsed.data.feature,
          }
        : null;
    if (brainRequested) {
      targetInput = resolveBrainTerminalTargetInput(inventory, targetInput);
    }
    if (!targetInput) {
      return NextResponse.json({ ok: true, alive: false });
    }
    const target = resolveTerminalTargetMachine(inventory, targetInput);
    if (!target) {
      if (!brainRequested && parsed.data.app && parsed.data.machineId) {
        targetApp = parsed.data.app;
        targetMachineId = parsed.data.machineId;
      } else {
        return NextResponse.json({ ok: true, alive: false });
      }
    } else {
      targetCfg = terminalFlyConfigForMachine(cfg, target, savedBrain);
      targetApp = target.app;
      targetMachineId = target.machineId;
    }
  } catch {
    if (brainRequested) {
      return NextResponse.json({ ok: true, alive: false });
    }
    targetCfg = cfg;
  }

  const bridge = await findTerminalBridge(targetCfg);
  if (!bridge) {
    return NextResponse.json({ ok: true, alive: false });
  }
  if (!targetApp || !targetMachineId) {
    return NextResponse.json({ ok: true, alive: false });
  }

  const token = mintTerminalBridgeToken({
    owner: ctx.context.owner,
    repo: ctx.context.repo,
    app: targetApp,
    orgSlug: targetCfg.orgSlug,
    machineId: targetMachineId,
    chatSessionId: parsed.data.chatSessionId,
    flyToken: targetCfg.token,
    ttlSeconds: 30,
    secret: bridge.secret,
  });

  try {
    const statusUrl = new URL("/status", bridge.url);
    statusUrl.searchParams.set("token", token);
    const res = await fetch(statusUrl, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return NextResponse.json({ ok: true, alive: false });
    const data = (await res.json().catch(() => ({}))) as {
      alive?: boolean;
      ready?: boolean;
      socketCount?: number;
      lastTouched?: number | null;
    };
    return NextResponse.json({
      ok: true,
      alive: Boolean(data.alive),
      ready: Boolean(data.ready),
      socketCount: data.socketCount ?? 0,
      lastTouched: data.lastTouched ?? null,
    });
  } catch {
    return NextResponse.json({ ok: true, alive: false });
  }
}
