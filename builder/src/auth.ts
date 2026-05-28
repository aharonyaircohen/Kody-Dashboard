/**
 * Shared-key auth. Both the dashboard (caller) and this service derive
 * the same key from KODY_MASTER_KEY using a purpose-prefix, so no shared
 * env var has to travel between deployments.
 *
 * Mirrors the pattern used by the runner pool (pool-keys.ts in the
 * dashboard).
 */

import { createHash } from "node:crypto";

const PURPOSE = "kody-preview-builder:v1";

export function deriveAuthKey(): string | null {
  const master = (process.env.KODY_MASTER_KEY ?? "").trim();
  if (!master) return null;
  return createHash("sha256").update(`${PURPOSE}:${master}`).digest("hex");
}

export function verifyAuth(header: string | undefined): boolean {
  const expected = deriveAuthKey();
  if (!expected) return false;
  const presented = (header ?? "").trim();
  if (!presented) return false;
  // Constant-time compare via Buffer xor.
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(presented, "hex");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
