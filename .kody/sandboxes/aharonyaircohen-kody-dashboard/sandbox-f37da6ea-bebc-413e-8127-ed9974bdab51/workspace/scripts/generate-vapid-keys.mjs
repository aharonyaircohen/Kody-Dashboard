#!/usr/bin/env node
/**
 * Inspect the deterministically-derived VAPID keypair for the dashboard.
 *
 * The dashboard derives its VAPID keypair from `KODY_MASTER_KEY` via HKDF
 * (`info="kody-vapid:v1"`, see src/dashboard/lib/push/vapid-keys.ts), so
 * there is NO separate `VAPID_*` env var to set. This script prints what
 * the live server is using — handy for debugging push delivery or for
 * sharing the public key with an external service.
 *
 * Usage:
 *   KODY_MASTER_KEY=<the hex/base64url master key> pnpm push:init
 */
import { createECDH, hkdfSync } from "node:crypto"

const masterRaw = process.env.KODY_MASTER_KEY?.trim()
if (!masterRaw) {
  process.stderr.write(
    "\nKODY_MASTER_KEY is not set. Source the same value you have in Vercel\n" +
      "  (Project → Settings → Environment Variables → KODY_MASTER_KEY)\n" +
      "and re-run, e.g.:\n\n" +
      "  KODY_MASTER_KEY=<value> pnpm push:init\n\n",
  )
  process.exit(1)
}

function base64Url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

const masterBytes =
  /^[0-9a-fA-F]{64}$/.test(masterRaw)
    ? Buffer.from(masterRaw, "hex")
    : Buffer.from(
        masterRaw.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      )

const scalar = Buffer.from(
  hkdfSync("sha256", masterBytes, Buffer.alloc(0), "kody-vapid:v1", 32),
)

const ecdh = createECDH("prime256v1")
ecdh.setPrivateKey(scalar)
const pub = ecdh.getPublicKey()

process.stdout.write(
  `\nVAPID public key:  ${base64Url(pub)}\n` +
    `VAPID private key: ${base64Url(scalar)}\n\n` +
    `These are derived from KODY_MASTER_KEY — you do NOT need to set them\n` +
    `as separate env vars in Vercel. Bump the HKDF info string ("kody-vapid:v1")\n` +
    `in src/dashboard/lib/push/vapid-keys.ts to rotate.\n\n`,
)
