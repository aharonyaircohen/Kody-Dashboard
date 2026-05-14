/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern push-vapid-public-key
 * @ai-summary GET returns the VAPID public key so the browser can call
 *   `pushManager.subscribe({ applicationServerKey })`. The keypair is
 *   derived deterministically from `KODY_MASTER_KEY` — no per-purpose env
 *   var, no fallback chain. See `src/dashboard/lib/push/vapid-keys.ts`.
 *
 *   Public key is intentionally readable without auth — it's published per
 *   the VAPID spec and reveals nothing exploitable on its own.
 *
 *   If `KODY_MASTER_KEY` is missing we return 503 with a hint rather than
 *   500 so the UI can degrade to "push not available on this server".
 */
import { NextResponse } from "next/server";
import { deriveVapidKeys } from "@dashboard/lib/push/vapid-keys";

export async function GET() {
  try {
    const { publicKey } = deriveVapidKeys();
    return NextResponse.json(
      { publicKey },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "push_not_configured",
        message: err instanceof Error ? err.message : "VAPID derivation failed",
      },
      { status: 503 },
    );
  }
}
