/**
 * @fileType utility
 * @domain runners
 * @pattern derived-pool-key
 * @ai-summary Server-only. Derives the warm-pool API key from KODY_MASTER_KEY,
 *   the dashboard's single canonical secret — same HKDF pattern as
 *   vapid-keys.ts. The engine's pool owner (kody2 src/pool/keys.ts) derives
 *   the IDENTICAL value from the same master, so the bearer the dashboard
 *   sends is never transmitted or stored anywhere — both sides compute it.
 *
 *   Derivation (MUST stay byte-identical to kody2/src/pool/keys.ts):
 *     POOL_API_KEY = hex( HKDF-SHA256(KODY_MASTER_KEY, info="kody-pool-api:v1", L=32) )
 */
import "server-only";
import { hkdfSync } from "crypto";

const POOL_API_KEY_INFO = "kody-pool-api:v1";

let cached: string | null = null;

function masterKeyBytes(raw: string): Buffer {
  const v = raw.trim();
  if (!v) throw new Error("KODY_MASTER_KEY is empty");
  if (/^[0-9a-fA-F]+$/.test(v) && v.length === 64) {
    return Buffer.from(v, "hex");
  }
  return Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Returns the derived pool API key, or null when KODY_MASTER_KEY is unset.
 * Null lets callers degrade gracefully (skip the pool, fall back to
 * create-fresh) instead of throwing on a misconfigured deploy.
 */
export function derivePoolApiKey(): string | null {
  if (cached) return cached;
  const raw = process.env.KODY_MASTER_KEY?.trim();
  if (!raw) return null;
  cached = Buffer.from(
    hkdfSync("sha256", masterKeyBytes(raw), Buffer.alloc(0), POOL_API_KEY_INFO, 32),
  ).toString("hex");
  return cached;
}

/** Test-only reset. */
export function _resetPoolKeyCacheForTests(): void {
  cached = null;
}
