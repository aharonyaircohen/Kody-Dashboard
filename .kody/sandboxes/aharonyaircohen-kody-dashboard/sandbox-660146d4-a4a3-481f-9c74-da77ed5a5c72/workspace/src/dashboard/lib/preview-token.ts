/**
 * @fileType util
 * @domain kody
 * @pattern preview-session-token
 *
 * Stateless HMAC tokens for granting access to per-PR Fly preview machines.
 * The dashboard mints a ticket (HMAC of "repo#pr:expiry", keyed by a derived
 * verify-only key) and appends it as a query param on the first iframe load.
 * The doorman proxy in each preview machine recomputes the HMAC; valid ticket
 * → Set-Cookie, then proxy through; invalid/missing/expired → 401.
 *
 * The verify-only key is derived from `KODY_MASTER_KEY` via HKDF with info
 * `"kody-preview:v1"` — distinct from the `"kody-chat-token:"` purpose that
 * chat-token.ts uses. Rotating `KODY_MASTER_KEY` invalidates all in-flight
 * preview tickets (same semantics as chat-token).
 */

import crypto from "crypto";

const PREVIEW_KEY_INFO = "kody-preview:v1";
const HMAC_BYTES = 16; // 128 bits — same output size as chat-token

/**
 * Derive a 32-byte verify-only key from `KODY_MASTER_KEY` using HKDF-SHA256.
 * This derived key is what ships to preview machines (via runtime env), not
 * the raw master key — containing blast radius if a preview machine env leaks.
 *
 * Throws if `KODY_MASTER_KEY` is not configured (same hard dependency as
 * `chat-token.ts` and `vapid-keys.ts`).
 */
export function derivePreviewKey(): Buffer {
  const masterRaw = process.env.KODY_MASTER_KEY?.trim();
  if (!masterRaw) {
    throw new Error(
      "KODY_MASTER_KEY is not configured — required for preview ticket derivation",
    );
  }

  let masterBytes: Buffer;
  if (/^[0-9a-fA-F]+$/.test(masterRaw) && masterRaw.length === 64) {
    masterBytes = Buffer.from(masterRaw, "hex");
  } else {
    masterBytes = Buffer.from(
      masterRaw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    );
  }

  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      masterBytes,
      Buffer.alloc(0),
      PREVIEW_KEY_INFO,
      32,
    ),
  );
}

/**
 * Mint a preview ticket.
 *
 * @param repo       "owner/name"
 * @param pr         PR number
 * @param ttlSec     Seconds until expiry
 * @returns          Opaque ticket string (base64url of { r, p, e, s })
 */
export function mintPreviewTicket(
  repo: string,
  pr: number,
  ttlSec: number,
): { ticket: string; expiresAt: number } {
  const derivedKey = derivePreviewKey();
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const subject = `${repo}#${pr}:${exp}`;

  const sig = crypto
    .createHmac("sha256", derivedKey)
    .update(subject)
    .digest("hex")
    .slice(0, HMAC_BYTES * 2);

  const payload = {
    r: repo,
    p: pr,
    e: exp,
    s: sig,
  };

  // base64url encoding
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return { ticket: encoded, expiresAt: exp };
}

/**
 * Verify a preview ticket.
 *
 * @param ticket     Opaque ticket from mintPreviewTicket
 * @param repo       "owner/name" — must match what was signed
 * @param pr         PR number — must match what was signed
 * @returns          true if valid and not expired; false otherwise
 */
export function verifyPreviewTicket(
  ticket: string,
  repo: string,
  pr: number,
): boolean {
  let payload: { r: string; p: number; e: number; s: string };
  try {
    payload = JSON.parse(Buffer.from(ticket, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  if (
    typeof payload.r !== "string" ||
    typeof payload.p !== "number" ||
    typeof payload.e !== "number" ||
    typeof payload.s !== "string"
  ) {
    return false;
  }

  // Envelope must match what the caller claims
  if (payload.r !== repo || payload.p !== pr) return false;

  // Check expiry first (no crypto work if already expired)
  const now = Math.floor(Date.now() / 1000);
  if (now >= payload.e) return false;

  // Re-derive the key and recompute the HMAC
  let derivedKey: Buffer;
  try {
    derivedKey = derivePreviewKey();
  } catch {
    return false;
  }

  const subject = `${repo}#${pr}:${payload.e}`;
  const expectedSig = crypto
    .createHmac("sha256", derivedKey)
    .update(subject)
    .digest("hex")
    .slice(0, HMAC_BYTES * 2);

  const a = Buffer.from(payload.s, "hex");
  const b = Buffer.from(expectedSig, "hex");
  if (a.length !== b.length) return false;

  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
