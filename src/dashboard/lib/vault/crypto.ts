/**
 * @fileType utility
 * @domain vault
 * @pattern crypto
 * @ai-summary Authenticated encryption for the dashboard vault. Uses AES-256-GCM
 *   with a 32-byte key from KODY_VAULT_KEY env (hex or base64). Output format:
 *   "v1:<iv_b64>:<ct_b64>:<tag_b64>". Same pattern as kody_session token
 *   encryption — separate key so vault and session rotate independently.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

const VERSION = "v1"

function getKey(): Buffer {
  const raw = process.env.KODY_VAULT_KEY
  if (!raw) {
    throw new Error(
      "KODY_VAULT_KEY is not configured. Run `pnpm vault:init` to generate one.",
    )
  }
  // Accept hex (64 chars) or base64 (44 chars including padding).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex")
  }
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== 32) {
    throw new Error(
      "KODY_VAULT_KEY must decode to 32 bytes (64-char hex or base64-encoded 32 bytes).",
    )
  }
  return buf
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION}:${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString("base64")}`
}

export function decrypt(payload: string): string {
  const parts = payload.split(":")
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Invalid vault payload format")
  }
  const [, ivB64, ctB64, tagB64] = parts
  const key = getKey()
  const iv = Buffer.from(ivB64, "base64")
  const ct = Buffer.from(ctB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString("utf8")
}

/** True if KODY_VAULT_KEY is configured and decodes correctly. */
export function isVaultConfigured(): boolean {
  try {
    getKey()
    return true
  } catch {
    return false
  }
}
