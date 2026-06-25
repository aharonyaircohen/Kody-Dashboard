/**
 * @fileType utility
 * @domain vault
 * @pattern crypto
 * @ai-summary Authenticated encryption for the dashboard vault. Uses AES-256-GCM
 *   with a 32-byte key from the KODY_MASTER_KEY env var (hex or base64).
 *   Output format: "v1:<iv_b64>:<ct_b64>:<tag_b64>".
 *
 *   Generate with `pnpm vault:init`. Rotating the key invalidates every
 *   encrypted secret in state repo `secrets.enc` — back values up first.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const VERSION = "v1";

/** Derive a verification string from a master key (SHA-256 hex). Used to
 *  check whether a user-supplied key matches the vault's key without
 *  attempting full decryption. */
export function deriveKeyCheck(key: string): string {
  const raw = normalizeKey(key);
  return createHash("sha256").update(raw).digest("hex");
}

/** Verify a user-supplied key against a stored keyCheck value. */
export function verifyKey(key: string, keyCheck: string): boolean {
  try {
    return deriveKeyCheck(key) === keyCheck;
  } catch {
    return false;
  }
}

/**
 * Normalize a raw key string to a 32-byte Buffer, accepting hex (64 chars)
 * or base64 (44 chars). Throws if the key cannot be decoded to 32 bytes.
 */
function normalizeKey(key: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, "hex");
  }
  const buf = Buffer.from(key, "base64");
  if (buf.length !== 32) {
    throw new Error("Key must decode to 32 bytes");
  }
  return buf;
}

function getKey(): Buffer {
  const raw = process.env.KODY_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "KODY_MASTER_KEY is not configured. Run `pnpm vault:init` to generate one.",
    );
  }
  try {
    return normalizeKey(raw);
  } catch {
    throw new Error(
      "KODY_MASTER_KEY must decode to 32 bytes (64-char hex or base64-encoded 32 bytes).",
    );
  }
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString("base64")}`;
}

export function decrypt(payload: string, keyOverride?: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Invalid vault payload format");
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const key = keyOverride ? normalizeKey(keyOverride) : getKey();
  const iv = Buffer.from(ivB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/** True if KODY_MASTER_KEY is configured and decodes correctly. */
export function isVaultConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
