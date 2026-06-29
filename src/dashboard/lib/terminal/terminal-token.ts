/**
 * @fileType utility
 * @domain terminal
 * @pattern encrypted-terminal-launch-token
 *
 * Short-lived encrypted launch tokens for the external terminal bridge.
 * The browser only sees opaque ciphertext; the Fly token is decrypted by the
 * trusted bridge process that actually attaches to the machine.
 */
import crypto from "crypto";

const TOKEN_VERSION = "kody-terminal-v1";
const DEFAULT_TTL_SECONDS = 120;

export interface TerminalBridgeClaims {
  sub: "kody-terminal";
  owner: string;
  repo: string;
  app: string;
  machineId: string;
  chatSessionId?: string;
  resetSession?: boolean;
  activityLimitMs?: number | null;
  localExec?: boolean;
  flyToken: string;
  cols: number;
  rows: number;
  iat: number;
  exp: number;
}

export interface MintTerminalBridgeTokenInput {
  owner: string;
  repo: string;
  app: string;
  machineId: string;
  chatSessionId?: string;
  resetSession?: boolean;
  activityLimitMs?: number | null;
  localExec?: boolean;
  flyToken: string;
  cols?: number;
  rows?: number;
  now?: number;
  ttlSeconds?: number;
  secret?: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64url(input: string): Buffer {
  const padded = input.padEnd(
    input.length + ((4 - (input.length % 4)) % 4),
    "=",
  );
  return Buffer.from(
    padded.replaceAll("-", "+").replaceAll("_", "/"),
    "base64",
  );
}

function getSecret(explicit?: string): string {
  const secret = explicit ?? process.env.KODY_MASTER_KEY;
  if (!secret) throw new Error("KODY_MASTER_KEY not configured");
  return secret;
}

function deriveKey(secret: string, purpose: "aes" | "hmac"): Buffer {
  return crypto
    .createHash("sha256")
    .update(`kody-terminal-bridge:${purpose}:${secret}`)
    .digest();
}

function sign(parts: string[], secret: string): string {
  return base64url(
    crypto
      .createHmac("sha256", deriveKey(secret, "hmac"))
      .update(parts.join("."))
      .digest(),
  );
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function mintTerminalBridgeToken(
  input: MintTerminalBridgeTokenInput,
): string {
  const secret = getSecret(input.secret);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const claims: TerminalBridgeClaims = {
    sub: "kody-terminal",
    owner: input.owner,
    repo: input.repo,
    app: input.app,
    machineId: input.machineId,
    chatSessionId: input.chatSessionId,
    resetSession: input.resetSession,
    activityLimitMs: input.activityLimitMs,
    localExec: input.localExec,
    flyToken: input.flyToken,
    cols: input.cols ?? 120,
    rows: input.rows ?? 36,
    iat: now,
    exp: now + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };

  const header = base64url(
    JSON.stringify({ typ: TOKEN_VERSION, alg: "HS256", enc: "A256GCM" }),
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    deriveKey(secret, "aes"),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(claims), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const encrypted = base64url(Buffer.concat([iv, tag, ciphertext]));
  const signature = sign([header, encrypted], secret);
  return `${header}.${encrypted}.${signature}`;
}

export function verifyTerminalBridgeToken(
  token: string,
  opts: { now?: number; secret?: string } = {},
): TerminalBridgeClaims {
  const secret = getSecret(opts.secret);
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("terminal token malformed");
  const [header, encrypted, signature] = parts as [string, string, string];
  const expected = sign([header, encrypted], secret);
  if (!timingSafeEqualString(signature, expected)) {
    throw new Error("terminal token signature invalid");
  }

  const headerJson = JSON.parse(fromBase64url(header).toString("utf8")) as {
    typ?: string;
  };
  if (headerJson.typ !== TOKEN_VERSION) {
    throw new Error("terminal token version invalid");
  }

  const packed = fromBase64url(encrypted);
  if (packed.length < 29) throw new Error("terminal token payload invalid");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret, "aes"),
    iv,
  );
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  const claims = JSON.parse(plaintext) as TerminalBridgeClaims;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (claims.sub !== "kody-terminal")
    throw new Error("terminal token subject invalid");
  if (claims.exp < now) throw new Error("terminal token expired");
  return claims;
}
