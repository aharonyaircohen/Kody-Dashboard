/**
 * @fileType util
 * @domain kody
 * @pattern chat-session-token
 *
 * Stateless HMAC tokens for authenticating chat event ingest POSTs from the
 * kody engine back to the dashboard. Generated server-side at dispatch time,
 * appended inline to the dashboardUrl query string, and verified on /ingest.
 *
 * Signed with KODY_MASTER_KEY (purpose-prefixed with `kody-chat-token:`
 * before hashing so this use is cryptographically separated from the
 * other consumers of the same key — vault, JWT, token AES).
 * Rotating the master key invalidates all in-flight session tokens,
 * which is the desired behavior on secret rotation.
 */

import crypto from "crypto";

const TOKEN_BYTES = 16; // 128 bits of HMAC output

function getSecret(): string {
  const s = process.env.KODY_MASTER_KEY;
  if (!s) throw new Error("KODY_MASTER_KEY not configured");
  return `kody-chat-token:${s}`;
}

export function mintSessionToken(sessionId: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(sessionId)
    .digest("hex")
    .slice(0, TOKEN_BYTES * 2);
}

export function verifySessionToken(sessionId: string, token: string): boolean {
  const expected = mintSessionToken(sessionId);
  const a = Buffer.from(token, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
