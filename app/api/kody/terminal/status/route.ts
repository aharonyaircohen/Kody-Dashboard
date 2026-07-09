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
  serverProviderConfigFromContext,
  resolveServerProviderContext,
} from "@dashboard/lib/infrastructure/server-context";
import { findServerProviderTerminalBridge } from "@dashboard/lib/infrastructure/server-terminal";
import {
  loadTerminalInventoryAuthority,
  terminalBridgeConfigCandidates,
  terminalFlyConfigForMachine,
} from "@dashboard/lib/terminal/server-inventory";
import {
  resolveBrainTerminalTargetInput,
  resolveTerminalTargetMachine,
  terminalBridgeSessionIdForTarget,
} from "@dashboard/lib/terminal/session";
import { mintTerminalBridgeToken } from "@dashboard/lib/terminal/terminal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    target: z.literal("brain").optional(),
    app: z.string().min(1).max(120).optional(),
    machineId: z.string().min(1).max(120).optional(),
    feature: z.enum(["runner", "brain"]).optional(),
    chatSessionId: z.string().min(1).max(160),
  })
  .superRefine((value, ctx) => {
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

function isFlyBridgeAuthError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return (
    /Fly Machines API (401|403) on \/(apps|apps\/)/.test(text) ||
    /fetch failed|Connect Timeout|ETIMEDOUT|ECONNRESET/i.test(text)
  );
}

function unavailable(reason: string) {
  return NextResponse.json({ ok: true, alive: false, reason });
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

  const ctx = await resolveServerProviderContext(req);
  if (!ctx.ok) {
    return unavailable("fly_context_unavailable");
  }
  const cfg = serverProviderConfigFromContext(ctx.context);
  if (!cfg) {
    return unavailable("fly_config_unavailable");
  }

  let targetCfg = cfg;
  let targetApp = parsed.data.app ?? "";
  let targetMachineId = parsed.data.machineId ?? "";
  const brainRequested =
    parsed.data.target === "brain" || parsed.data.feature === "brain";
  try {
    const { inventory, savedBrain } = await loadTerminalInventoryAuthority(
      req,
      cfg,
      {
        brainRequested,
        app: parsed.data.app,
        machineId: parsed.data.machineId,
      },
      ctx.context,
    );
    let targetInput: {
      app: string;
      machineId: string;
      feature?: "runner" | "brain";
    } | null =
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
      return unavailable("target_not_found");
    }
    const target = resolveTerminalTargetMachine(inventory, targetInput);
    if (!target) {
      if (!brainRequested && parsed.data.app && parsed.data.machineId) {
        targetApp = parsed.data.app;
        targetMachineId = parsed.data.machineId;
      } else {
        return unavailable("target_machine_not_found");
      }
    } else {
      targetCfg = terminalFlyConfigForMachine(cfg, target, savedBrain);
      targetApp = target.app;
      targetMachineId = target.machineId;
    }
  } catch {
    if (brainRequested) {
      return unavailable("brain_resolution_failed");
    }
    targetCfg = cfg;
  }

  let bridge = null;
  let bridgeCfg = targetCfg;
  for (const candidate of terminalBridgeConfigCandidates(targetCfg)) {
    try {
      bridge = await findServerProviderTerminalBridge(candidate);
      if (bridge) {
        bridgeCfg = candidate;
        break;
      }
    } catch (err) {
      if (!isFlyBridgeAuthError(err)) throw err;
    }
  }
  if (!bridge) {
    return unavailable("bridge_not_found");
  }
  if (!targetApp || !targetMachineId) {
    return unavailable("target_not_resolved");
  }

  const token = mintTerminalBridgeToken({
    owner: ctx.context.owner,
    repo: ctx.context.repo,
    app: targetApp,
    orgSlug: bridgeCfg.orgSlug,
    machineId: targetMachineId,
    chatSessionId: terminalBridgeSessionIdForTarget({
      owner: ctx.context.owner,
      repo: ctx.context.repo,
      app: targetApp,
      machineId: targetMachineId,
      feature: brainRequested ? "brain" : (parsed.data.feature ?? "runner"),
      requestedChatSessionId: parsed.data.chatSessionId,
    }),
    flyToken: bridgeCfg.token,
    ttlSeconds: 30,
    secret: bridge.secret,
  });

  try {
    const statusUrl = new URL("/status", bridge.url);
    statusUrl.searchParams.set("token", token);
    const res = await fetch(statusUrl, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return unavailable("bridge_status_failed");
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
    return unavailable("bridge_unreachable");
  }
}
