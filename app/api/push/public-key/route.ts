/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern push-vapid-public-key
 * @ai-summary GET returns the dashboard's VAPID public key so the browser
 *   can call `pushManager.subscribe({ applicationServerKey })`. The public
 *   key is intentionally readable without auth — it's published per the
 *   VAPID spec and reveals nothing exploitable on its own.
 *
 *   If env vars aren't configured we return 503 with a hint rather than 500
 *   so the UI can degrade to "push not available on this server".
 */
import { NextResponse } from "next/server";

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) {
    return NextResponse.json(
      { error: "push_not_configured", message: "VAPID keys are not set on the server" },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { publicKey },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
