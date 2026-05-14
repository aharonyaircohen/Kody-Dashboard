#!/usr/bin/env node
/**
 * Generate a VAPID keypair for the dashboard's web-push channel.
 *
 * Usage:
 *   pnpm push:init
 *
 * Prints the public + private key. Paste into:
 *   - Vercel env vars (Production + Preview):
 *       VAPID_PUBLIC_KEY=<public>
 *       VAPID_PRIVATE_KEY=<private>
 *       VAPID_SUBJECT=mailto:you@example.com   # optional, only used for
 *                                                abuse-reporting by push svcs
 *
 *   - Your password manager — losing the private key invalidates every
 *     existing subscription (devices will need to re-subscribe).
 */
import webpush from "web-push"

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

process.stdout.write(
  `\n` +
    `VAPID_PUBLIC_KEY=${publicKey}\n` +
    `VAPID_PRIVATE_KEY=${privateKey}\n` +
    `# VAPID_SUBJECT=mailto:you@example.com\n` +
    `\n` +
    `Add the lines above to:\n` +
    `  - Vercel -> Project Settings -> Environment Variables (Production + Preview)\n` +
    `  - Your password manager (1Password / Bitwarden / etc.) for recovery\n\n` +
    `Losing the private key invalidates every existing browser subscription —\n` +
    `users will need to re-enable push from their device.\n\n`,
)
