/**
 * @fileType utility
 * @domain preview
 * @pattern encrypted-view-token
 * @ai-summary Short-lived encrypted access tokens for repo-backed static
 * views. The browser sees only opaque ciphertext; the API decrypts it to read
 * `.kody/views/<id>` files from the connected GitHub repo for iframe loads.
 */
import crypto from "crypto";

const TOKEN_VERSION = "kody-view-v1";
const DEFAULT_TTL_SECONDS = 4 * 60 * 60;

export interface RepoViewClaims {
  sub: "kody-view";
  owner: string;
  repo: string;
  viewId: string;
  githubToken: string;
  iat: number;
  exp: number;
}

export interface MintRepoViewTokenInput {
  owner: string;
  repo: string;
  viewId: string;
  githubToken: string;
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
    .update(`kody-repo-view:${purpose}:${secret}`)
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
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function mintRepoViewToken(
  input: MintRepoViewTokenInput,
): { token: string; expiresAt: number } {
  const secret = getSecret(input.secret);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const exp = now + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const claims: RepoViewClaims = {
    sub: "kody-view",
    owner: input.owner,
    repo: input.repo,
    viewId: input.viewId,
    githubToken: input.githubToken,
    iat: now,
    exp,
  };
  const header = base64url(JSON.stringify({ typ: TOKEN_VERSION }));
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
  return { token: `${header}.${encrypted}.${signature}`, expiresAt: exp };
}

export function verifyRepoViewToken(
  token: string,
  opts: { now?: number; secret?: string } = {},
): RepoViewClaims {
  const secret = getSecret(opts.secret);
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("view token malformed");
  const [header, encrypted, signature] = parts as [string, string, string];
  const expected = sign([header, encrypted], secret);
  if (!timingSafeEqualString(signature, expected)) {
    throw new Error("view token signature invalid");
  }

  const headerJson = JSON.parse(fromBase64url(header).toString("utf8")) as {
    typ?: string;
  };
  if (headerJson.typ !== TOKEN_VERSION) {
    throw new Error("view token version invalid");
  }

  const packed = fromBase64url(encrypted);
  if (packed.length < 29) throw new Error("view token payload invalid");
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
  const claims = JSON.parse(plaintext) as RepoViewClaims;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (claims.sub !== "kody-view") throw new Error("view token subject invalid");
  if (claims.exp < now) throw new Error("view token expired");
  return claims;
}
