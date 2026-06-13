/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-deprecated
 *
 * Chat is now routed through GitHub Actions + Kody Engine.
 * This endpoint is deprecated — see POST /api/kody/chat/trigger.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const authError = await requireKodyAuth(req);
    if (authError) return authError;

    return NextResponse.json({
      status: "Chat endpoint deprecated. Use POST /api/kody/chat/trigger.",
      deprecated: true,
    });
  } catch (error) {
    logger.error({ err: error }, "Chat GET error");
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

export async function POST(_req: NextRequest) {
  // Chat is now routed through GitHub Actions + Kody Engine via /api/kody/chat/trigger.
  // This endpoint is deprecated and will be removed in a future release.
  return NextResponse.json(
    {
      error:
        "Direct chat is deprecated. Use POST /api/kody/chat/trigger instead.",
      deprecated: true,
    },
    { status: 410 },
  );
}
