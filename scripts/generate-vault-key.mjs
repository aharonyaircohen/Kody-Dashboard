#!/usr/bin/env node
/**
 * Generate a 32-byte AES-256-GCM key for the dashboard vault.
 *
 * Usage:
 *   pnpm vault:init
 *
 * Prints the key in hex. Paste it into:
 *   1) Vercel project env vars as KODY_VAULT_KEY (Production + Preview)
 *   2) Your password manager — losing this key invalidates every secret.
 */
import { randomBytes } from "crypto"

const key = randomBytes(32).toString("hex")
process.stdout.write(
  `\nKODY_VAULT_KEY=${key}\n\n` +
    `Add the line above to:\n` +
    `  - Vercel -> Project Settings -> Environment Variables (Production + Preview)\n` +
    `  - Your password manager (1Password / Bitwarden / etc.) for recovery\n\n` +
    `Losing this key means every secret in .kody/secrets.enc becomes unreadable\n` +
    `and must be re-entered. Save it.\n\n`,
)
