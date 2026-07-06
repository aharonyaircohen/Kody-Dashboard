/**
 * @fileType api-endpoint
 * @domain terminal
 * @pattern terminal-session-start
 *
 * Starts a browser terminal session by ensuring the Fly terminal bridge exists
 * and minting a short-lived encrypted token for it. The Fly token stays
 * encrypted inside that token; the dashboard never returns it as plain JSON.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireKodyAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";
import {
  startTerminalSession,
  TerminalSessionError,
} from "@dashboard/lib/terminal/session-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Body = z
  .object({
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

  try {
    return NextResponse.json(
      await startTerminalSession({
        req,
        context: ctx.context,
        data: parsed.data,
      }),
    );
  } catch (err) {
    if (err instanceof TerminalSessionError) {
      return NextResponse.json(
        { error: err.code, message: err.message, ...err.details },
        { status: err.status },
      );
    }
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
