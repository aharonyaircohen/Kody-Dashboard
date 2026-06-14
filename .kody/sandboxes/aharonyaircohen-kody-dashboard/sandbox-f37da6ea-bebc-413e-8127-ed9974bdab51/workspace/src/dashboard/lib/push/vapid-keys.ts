/**
 * @fileType utility
 * @domain kody
 * @pattern derived-vapid-keys
 * @ai-summary Server-only. Derives a deterministic VAPID P-256 keypair from
 *   `KODY_MASTER_KEY`, the dashboard's single canonical secret. No
 *   per-purpose env var, no fallback chains — same pattern as
 *   `kody-chat-token:` and `kody-token-encryption:` for HMAC/AES, applied
 *   here to the EC scalar that signs Web Push messages.
 *
 *   Derivation:
 *     priv_scalar = HKDF-SHA256(KODY_MASTER_KEY, info="kody-vapid:v1", L=32)
 *     pub = scalar × G  (computed via Node's createECDH on prime256v1)
 *
 *   Returns base64url strings in the shape `web-push` expects: 65-byte
 *   uncompressed public point (0x04 || X || Y) and 32-byte private scalar.
 *
 *   Cached at module level — derivation costs ~ms but VAPID never rotates
 *   without a deliberate `KODY_MASTER_KEY` rotation, which already
 *   invalidates everything else (vault, HMACs, etc.).
 */
import "server-only";
import { createECDH, hkdfSync } from "crypto";

interface VapidKeypair {
  publicKey: string;
  privateKey: string;
}

let cached: VapidKeypair | null = null;

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Throws if `KODY_MASTER_KEY` isn't set. The dashboard's existing vault
 * code also requires it, so this is the same hard dependency we already
 * have — adding push doesn't widen the env-var surface.
 */
export function deriveVapidKeys(): VapidKeypair {
  if (cached) return cached;

  const masterRaw = process.env.KODY_MASTER_KEY?.trim();
  if (!masterRaw) {
    throw new Error(
      "KODY_MASTER_KEY is not configured — required for VAPID key derivation",
    );
  }

  // Accept hex (64 chars) or base64url. Same shape the vault accepts.
  let masterBytes: Buffer;
  if (/^[0-9a-fA-F]+$/.test(masterRaw) && masterRaw.length === 64) {
    masterBytes = Buffer.from(masterRaw, "hex");
  } else {
    masterBytes = Buffer.from(
      masterRaw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    );
  }

  // HKDF → 32-byte scalar. The `info` string is the purpose prefix; bumping
  // it (e.g. ":v2") rotates everyone's VAPID without changing the master.
  const scalar = Buffer.from(
    hkdfSync("sha256", masterBytes, Buffer.alloc(0), "kody-vapid:v1", 32),
  );

  // Vanishingly improbable failures: the scalar must be in [1, n-1] where n
  // is the P-256 group order. Node's `setPrivateKey` will throw if it isn't.
  // If it ever does we'll need to bump the info string to "kody-vapid:v2"
  // and re-derive; for now we don't bother with rejection sampling because
  // the probability of HKDF-SHA256 producing 0 or ≥ n is < 2^-128.
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  const publicKeyBytes = ecdh.getPublicKey(); // uncompressed, 65 bytes

  cached = {
    publicKey: base64Url(publicKeyBytes),
    privateKey: base64Url(scalar),
  };
  return cached;
}

/** Test-only reset (the cache is otherwise immutable per-process). */
export function _resetVapidCacheForTests(): void {
  cached = null;
}
