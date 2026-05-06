/**
 * @fileType utility
 * @domain vault
 * @pattern crypto
 * @ai-summary Authenticated encryption for the dashboard vault. Uses AES-256-GCM
 *   with a 32-byte key derived via HKDF-SHA256 from the existing
 *   KODY_SESSION_SECRET — no extra env var to configure. Domain separation
 *   (salt = "kody-vault-v1") keeps this key distinct from session signing /
 *   token encryption, which use their own derivations from the same secret.
 *   Output format: "v1:<iv_b64>:<ct_b64>:<tag_b64>".
 *
 *   Tradeoff: rotating KODY_SESSION_SECRET also invalidates every encrypted
 *   secret in .kody/secrets.enc. Acceptable because session-secret rotation
 *   is rare and stored values are third-party API keys (re-issuable).
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto"

const VERSION = "v1"
const HKDF_SALT = "kody-vault-v1"
const HKDF_INFO = "aes-256-gcm"

function getKey(): Buffer {
  const secret = process.env.KODY_SESSION_SECRET
  if (!secret) {
    throw new Error("KODY_SESSION_SECRET is required for the vault")
  }
  const derived = hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.from(HKDF_SALT, "utf8"),
    Buffer.from(HKDF_INFO, "utf8"),
    32,
  )
  return Buffer.from(derived)
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
