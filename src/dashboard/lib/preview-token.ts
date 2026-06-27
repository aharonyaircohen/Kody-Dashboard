/**
 * @fileType util
 * @domain kody
 * @pattern preview-session-token
 *
 * Stateless HMAC tickets for granting access to protected Fly preview machines.
 * The preview doorman validates the ticket and sets its own session cookie.
 */

import crypto from "crypto";

const PREVIEW_KEY_INFO = "kody-preview:v1";
const HMAC_BYTES = 16;

export function derivePreviewKey(): Buffer {
  const masterRaw = process.env.KODY_MASTER_KEY?.trim();
  if (!masterRaw) {
    throw new Error(
      "KODY_MASTER_KEY is not configured — required for preview ticket derivation",
    );
  }

  const masterBytes =
    /^[0-9a-fA-F]+$/.test(masterRaw) && masterRaw.length === 64
      ? Buffer.from(masterRaw, "hex")
      : Buffer.from(masterRaw.replace(/-/g, "+").replace(/_/g, "/"), "base64");

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

export function mintPreviewTicket(
  repo: string,
  pr: number,
  ttlSec: number,
): { ticket: string; expiresAt: number } {
  return mintTicket({ r: repo, p: pr }, ttlSec);
}

export function mintBranchPreviewTicket(
  repo: string,
  branch: string,
  ttlSec: number,
): { ticket: string; expiresAt: number } {
  return mintTicket({ r: repo, b: branch }, ttlSec);
}

type PreviewTicketIdentity =
  | { r: string; p: number; b?: never }
  | { r: string; b: string; p?: never };

type PreviewTicketPayload = PreviewTicketIdentity & {
  e: number;
  s: string;
};

function buildSubject(identity: PreviewTicketIdentity, exp: number): string {
  if ("p" in identity) return `${identity.r}#${identity.p}:${exp}`;
  return `${identity.r}@${identity.b}:${exp}`;
}

function mintTicket(
  identity: PreviewTicketIdentity,
  ttlSec: number,
): { ticket: string; expiresAt: number } {
  const derivedKey = derivePreviewKey();
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const subject = buildSubject(identity, exp);

  const sig = crypto
    .createHmac("sha256", derivedKey)
    .update(subject)
    .digest("hex")
    .slice(0, HMAC_BYTES * 2);

  return {
    ticket: Buffer.from(
      JSON.stringify({ ...identity, e: exp, s: sig }),
    ).toString("base64url"),
    expiresAt: exp,
  };
}

function decodePreviewTicket(ticket: string): PreviewTicketPayload | null {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(ticket, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const hasPr = typeof p.p === "number";
  const hasBranch = typeof p.b === "string";
  if (
    typeof p.r !== "string" ||
    typeof p.e !== "number" ||
    typeof p.s !== "string" ||
    hasPr === hasBranch
  ) {
    return null;
  }

  return p as PreviewTicketPayload;
}

export function verifyPreviewTicket(
  ticket: string,
  repo: string,
  pr: number,
): boolean {
  return verifyTicket(ticket, { r: repo, p: pr });
}

export function verifyBranchPreviewTicket(
  ticket: string,
  repo: string,
  branch: string,
): boolean {
  return verifyTicket(ticket, { r: repo, b: branch });
}

function sameIdentity(
  payload: PreviewTicketPayload,
  expected: PreviewTicketIdentity,
): boolean {
  if (payload.r !== expected.r) return false;
  if ("p" in expected) return payload.p === expected.p;
  return payload.b === expected.b;
}

function verifyTicket(
  ticket: string,
  expected: PreviewTicketIdentity,
): boolean {
  const payload = decodePreviewTicket(ticket);
  if (!payload) return false;
  if (!sameIdentity(payload, expected)) return false;
  if (Math.floor(Date.now() / 1000) >= payload.e) return false;

  let derivedKey: Buffer;
  try {
    derivedKey = derivePreviewKey();
  } catch {
    return false;
  }

  const expectedSig = crypto
    .createHmac("sha256", derivedKey)
    .update(buildSubject(expected, payload.e))
    .digest("hex")
    .slice(0, HMAC_BYTES * 2);

  const actual = Buffer.from(payload.s, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (actual.length !== expectedBuf.length) return false;

  try {
    return crypto.timingSafeEqual(actual, expectedBuf);
  } catch {
    return false;
  }
}
